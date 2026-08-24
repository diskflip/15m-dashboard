import WebSocket from "ws";
import { signRequest } from "./kalshiAuth.ts";
import { config } from "./config.ts";

type PriceCallback = (prices: { yes: number }) => void;

const WS_PATH = "/trade-api/ws/v2";
const RECONNECT_DELAY_MS = 3000;
// Once we've accumulated this many warm (subscribed-but-not-active) tickers
// for one feed, drop the whole channel subscription and re-subscribe to just
// {active, next} — Kalshi's WS API has no documented way to unsubscribe a
// single market_ticker from a shared sid (confirmed live: an "action":
// "remove_markets" guess on update_subscription came back "Unsupported
// action"), so periodic full-reset is the simple way to avoid the
// subscription list growing forever. A brief resubscribe blip from this only
// ever happens mid-window, never at a rollover boundary.
const PRUNE_THRESHOLD = 4;

// Kalshi's wire format prices as decimal-dollar strings (e.g. "0.0800"),
// not integer cents — convert once at the boundary.
function dollarsToCents(dollars: string): number {
  return Math.round(parseFloat(dollars) * 100);
}

// Maintains a single WebSocket connection to Kalshi, subscribed to the
// `ticker` channel, and reports the YES bid price Kalshi's own matching
// engine computes (matches what their site shows) for whichever ticker is
// currently "active" — see promote().
//
// We used to reconstruct this ourselves from raw `orderbook_delta` events —
// tracking best-bid across thousands of adds/cancels per second. That was
// fragile (subscription/sequence bookkeeping was a persistent source of
// stale state) and, worse, technically correct but misleading: the
// orderbook's literal best bid can be an almost-zero-size stub order that
// doesn't reflect the real market. The ticker channel is Kalshi's own BBO
// summary — authoritative, and there's no delta continuity to track since
// every message is a complete, standalone snapshot.
//
// Rollover handling: ensureSubscribed() can be called well before a market
// is even open (Kalshi accepts it fine — it just won't have anything to
// send until trading starts), so the caller (index.ts) pre-subscribes to
// next window's already-known ticker ahead of time and calls promote() at
// the precise close boundary — no subscribe round-trip happens AT the
// rollover, which is what used to create the visible gap/latency.
export class KalshiFeed {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private onPrice: PriceCallback;
  private closedByCaller = false;
  // Every ticker we've ever asked Kalshi to stream for this feed. All of
  // them share one sid (confirmed live: subscribing to a second
  // market_ticker on the same channel just adds it to the existing
  // subscription's market_tickers list rather than creating a new sid) —
  // so we don't need per-ticker sid bookkeeping, just this set plus which
  // one is currently active.
  private subscribedTickers = new Set<string>();
  private activeTicker: string | null = null;

  constructor(onPrice: PriceCallback) {
    this.onPrice = onPrice;
  }

  start() {
    this.connect();
  }

  stop() {
    this.closedByCaller = true;
    this.ws?.close();
  }

  // Safe to call for a market that hasn't opened yet — no-op if already
  // subscribed.
  ensureSubscribed(ticker: string) {
    if (this.subscribedTickers.has(ticker)) return;
    this.subscribedTickers.add(ticker);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        id: this.nextId++,
        cmd: "subscribe",
        params: { channels: ["ticker"], market_tickers: [ticker] },
      });
    }
    // If not yet open, connect()'s onopen handler resubscribes everything
    // tracked here once ready.
  }

  // Makes `ticker` the one whose price ticks get forwarded via onPrice.
  // Prices for any other subscribed ticker are still received (so a stale
  // in-flight message from the market that just closed can't leak through
  // as if it were the new one) but silently dropped.
  promote(ticker: string) {
    this.ensureSubscribed(ticker);
    this.activeTicker = ticker;
    if (this.subscribedTickers.size > PRUNE_THRESHOLD) this.prune();
  }

  private prune() {
    const keep = this.activeTicker ? [this.activeTicker] : [];
    this.subscribedTickers = new Set();
    if (this.ws?.readyState === WebSocket.OPEN) {
      // No documented per-ticker unsubscribe — drop the whole channel and
      // start clean. Only ever triggered mid-window (see PRUNE_THRESHOLD),
      // never right at a rollover.
      this.send({ id: this.nextId++, cmd: "unsubscribe", params: { channels: ["ticker"] } });
    }
    for (const ticker of keep) this.ensureSubscribed(ticker);
  }

  private connect() {
    const headers = signRequest("GET", WS_PATH);
    const ws = new WebSocket(`${config.wsUrl}`, { headers });
    this.ws = ws;

    ws.on("open", () => {
      for (const ticker of this.subscribedTickers) {
        this.send({
          id: this.nextId++,
          cmd: "subscribe",
          params: { channels: ["ticker"], market_tickers: [ticker] },
        });
      }
    });

    ws.on("message", (raw) => this.handleMessage(raw.toString()));

    ws.on("close", () => {
      if (!this.closedByCaller) {
        setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    });

    ws.on("error", (err) => {
      console.error("[kalshi-ws] error:", err.message);
    });
  }

  private send(payload: unknown) {
    this.ws?.send(JSON.stringify(payload));
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "ticker": {
        if (msg.msg?.market_ticker !== this.activeTicker) return;
        if (typeof msg.msg.yes_bid_dollars !== "string") return;
        // Used to also drop any tick where yes_bid_size_fp was 0, on the
        // theory that a sizeless bid is just Kalshi's "no resting order"
        // placeholder rather than a real price (true right at window close,
        // where the book empties out). Reverted: that field goes to 0
        // constantly during completely normal trading too — any moment the
        // best bid gets fully taken before a new one rests — so the filter
        // was silently dropping a large fraction of genuine live ticks all
        // game long, not just the closing artifact, which is what was
        // making the charts look smoothed instead of showing every real
        // price move.
        this.onPrice({ yes: dollarsToCents(msg.msg.yes_bid_dollars) });
        break;
      }
      case "error": {
        console.error("[kalshi-ws] server error:", msg.msg);
        break;
      }
    }
  }
}
