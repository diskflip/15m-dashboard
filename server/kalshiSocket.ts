import WebSocket from "ws";
import { signRequest } from "./kalshiAuth.ts";
import { config } from "./config.ts";

type PriceCallback = (prices: { yes: number }) => void;

const WS_PATH = "/trade-api/ws/v2";
const RECONNECT_DELAY_MS = 3000;
// Kalshi has no per-ticker unsubscribe, so once a feed accumulates this many
// warm (subscribed-but-not-active) tickers, drop the whole subscription and
// re-subscribe to just the active one.
const PRUNE_THRESHOLD = 4;

function dollarsToCents(dollars: string): number {
  return Math.round(parseFloat(dollars) * 100);
}

// One WebSocket per market, subscribed to Kalshi's public `ticker` channel
// (its own best-bid summary, not a hand-rolled orderbook reconstruction),
// reporting the YES bid for whichever ticker is currently "active" via
// promote(). ensureSubscribed() can be called before a market even opens,
// so the caller pre-subscribes the next window ahead of time and calls
// promote() right at the close boundary, with no subscribe round-trip on
// the critical path.
export class KalshiFeed {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private onPrice: PriceCallback;
  private closedByCaller = false;
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
  }

  // Prices for other subscribed tickers still arrive but are dropped —
  // only the promoted one gets forwarded via onPrice.
  promote(ticker: string) {
    this.ensureSubscribed(ticker);
    this.activeTicker = ticker;
    if (this.subscribedTickers.size > PRUNE_THRESHOLD) this.prune();
  }

  private prune() {
    const keep = this.activeTicker ? [this.activeTicker] : [];
    this.subscribedTickers = new Set();
    if (this.ws?.readyState === WebSocket.OPEN) {
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
