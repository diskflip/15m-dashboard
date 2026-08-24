import WebSocket from "ws";
import { signRequest } from "./kalshiAuth.ts";
import { config } from "./config.ts";

const WS_PATH = "/trade-api/ws/v2";
const RECONNECT_DELAY_MS = 3000;

// `intent` is only present for real `fill` messages (a genuine trade).
// Confirmed against live fill payloads: Kalshi's own `action` field ("buy"/
// "sell") does NOT reliably say entry vs. exit — "sell yes at 94c" is the
// same trade as "buy no at 6c", so an entry into NO can show action:"sell"
// and an exit out of NO (sold back at 85c) can show action:"buy" of yes.
// The reliable signal is this bot's own `client_order_id`, which always
// encodes its intent: an entry order id looks like
// "scalpyes-<ticker>-yes-t0600-..." / "scalpno-...-no-t0600-...", an exit
// order id looks like "scalpexyes1-<ticker>-yes-95-...-e0600" /
// "scalpexno1-...-no-85-...-e0600" — the "ex" is what marks it as a close.
// `market_positions` messages carry no order id at all, so it's left
// undefined for those. `side`/`priceCents` describe the fill itself (which
// side was purchased, and its price in the app's usual 0-100 cents
// convention) — carried through so a consumer can show/log exactly what
// traded, not just that "something" did.
export type FillEvent = {
  ticker: string;
  intent?: "entry" | "exit";
  side?: "yes" | "no";
  priceCents?: number;
};

// Pushed on the `market_positions` channel whenever a fill changes a
// ticker's net position — `positionFp` is signed (positive = net YES
// contracts held, negative = net NO), `costDollars` is total cost paid for
// that position. Enough to derive unrealized P&L against a live price
// without waiting for settlement.
export type PositionUpdate = { ticker: string; positionFp: number; costDollars: number };

function intentFromClientOrderId(clientOrderId: unknown): "entry" | "exit" | undefined {
  if (typeof clientOrderId !== "string") return undefined;
  if (clientOrderId.startsWith("scalpex")) return "exit";
  if (clientOrderId.startsWith("scalpyes") || clientOrderId.startsWith("scalpno")) return "entry";
  return undefined;
}

// Strips the random per-order suffix out of a client_order_id, leaving a
// key that's stable across every order the bot places for the same
// logical action (one window, one side, one entry-or-exit attempt).
// Confirmed against live fills: a single "try to buy in at 6c" attempt can
// span *two different order_ids* seconds apart (the resting order gets
// replaced/re-rested when it doesn't fully fill right away), e.g.
// ".../yes-t0600-ddaf81cd" and ".../yes-t0600-15762ffa" for the same
// window+side within 2 seconds — deduping on raw order_id missed this
// because they're genuinely different orders. The random part is always
// exactly 8 lowercase hex chars, but its position differs between entry
// ids (trailing) and exit ids (mid-string, followed by a fixed "e0600"),
// so this filters out any 8-hex-char segment wherever it falls rather than
// assuming a fixed position.
function stableActionKey(clientOrderId: string): string {
  return clientOrderId
    .split("-")
    .filter((segment) => !/^[0-9a-f]{8}$/.test(segment))
    .join("-");
}

// A single account-wide authenticated connection to Kalshi's private `fill`
// and `market_positions` channels — both push the instant something
// happens, so "order just filled" doesn't have to wait on the next
// portfolio poll (up to 5s away, per PORTFOLIO_POLL_MS in index.ts).
//
// Checked directly against Kalshi's WS API: there is no push channel for
// resting orders — "order", "orders", "order_update", "resting_order" all
// come back "Unknown channel name". Only `fill` and `market_positions`
// exist as private channels, so resting-order detection is stuck on the
// REST poll; holding/position detection does not have to be.
//
// Separate from KalshiFeed (which is per-market and only subscribes to the
// public `ticker` channel): these aren't scoped to one market, so this is
// one connection for everything, not one per tracked market.
export class KalshiFillsFeed {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private onSignal: (event: FillEvent) => void;
  private onPosition: (update: PositionUpdate) => void;
  private closedByCaller = false;
  // One logical entry/exit attempt (one window, one side) commonly spans
  // several partial fills — and sometimes several different order_ids, when
  // a resting order gets replaced — within a couple seconds. All of that is
  // the same action from the trader's point of view, not a new one each
  // time. Only the first fill seen for a given stableActionKey fires a
  // signal (and therefore a sound); the key is scoped to one window+side so
  // it naturally stops mattering once that window closes — fine to just
  // keep growing for the life of the process at real trading volumes.
  private seenActionKeys = new Set<string>();

  constructor(onSignal: (event: FillEvent) => void, onPosition: (update: PositionUpdate) => void) {
    this.onSignal = onSignal;
    this.onPosition = onPosition;
  }

  start() {
    this.connect();
  }

  stop() {
    this.closedByCaller = true;
    this.ws?.close();
  }

  private connect() {
    const headers = signRequest("GET", WS_PATH);
    const ws = new WebSocket(`${config.wsUrl}`, { headers });
    this.ws = ws;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          id: this.nextId++,
          cmd: "subscribe",
          params: { channels: ["fill", "market_positions"] },
        })
      );
    });

    ws.on("message", (raw) => this.handleMessage(raw.toString()));

    ws.on("close", () => {
      if (!this.closedByCaller) {
        setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    });

    ws.on("error", (err) => {
      console.error("[kalshi-fills-ws] error:", err.message);
    });
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "error") {
      console.error("[kalshi-fills-ws] server error:", msg.msg);
      return;
    }
    if (msg.type === "subscribed") {
      console.log("[kalshi-fills-ws] subscribed:", raw);
      return;
    }
    if (msg.type !== "fill" && msg.type !== "market_position" && msg.type !== "market_positions") {
      // Logged so an unexpected type name is visible instead of silently
      // dropped — this is exactly how the real `fill` field names got
      // confirmed earlier.
      console.log("[kalshi-fills-ws] unhandled message type:", raw);
      return;
    }

    console.log("[kalshi-fills-ws] signal received:", raw);

    // Same field the public `ticker` channel uses (see kalshiSocket.ts) —
    // tried defensively across a few plausible names since this is the
    // first real market_position payload we've seen.
    const ticker = msg.msg?.market_ticker ?? msg.msg?.ticker;
    if (typeof ticker !== "string") {
      console.warn("[kalshi-fills-ws] message missing ticker:", raw);
      return;
    }
    if (msg.type === "market_position" || msg.type === "market_positions") {
      const positionFp = parseFloat(msg.msg?.position_fp);
      const costDollars = parseFloat(msg.msg?.position_cost_dollars);
      if (!Number.isNaN(positionFp) && !Number.isNaN(costDollars)) {
        this.onPosition({ ticker, positionFp, costDollars });
      }
      return;
    }

    const clientOrderId = msg.msg?.client_order_id;
    let intent = intentFromClientOrderId(clientOrderId);
    if (intent !== undefined && typeof clientOrderId === "string") {
      const key = stableActionKey(clientOrderId);
      if (this.seenActionKeys.has(key)) {
        intent = undefined; // already signaled this window+side attempt
      } else {
        this.seenActionKeys.add(key);
      }
    }

    const side: "yes" | "no" | undefined =
      msg.msg?.purchased_side === "yes" || msg.msg?.purchased_side === "no"
        ? msg.msg.purchased_side
        : undefined;
    const yesPriceCents = Math.round(parseFloat(msg.msg?.yes_price_dollars) * 100);
    const priceCents = Number.isFinite(yesPriceCents)
      ? side === "no"
        ? 100 - yesPriceCents
        : yesPriceCents
      : undefined;

    this.onSignal({ ticker, intent, side, priceCents });
  }
}
