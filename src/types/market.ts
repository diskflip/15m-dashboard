// Chart-facing data shape. Every market (BTC, DOGE, ...) is reduced to this
// before it reaches MarketChart, so the chart component never knows about Kalshi.
export type PricePoint = {
  time: number; // unix seconds
  yes: number; // YES side's best bid, in cents (0-100). NO = 100 - yes.
};

// A PricePoint as committed into a chart's rolling history buffer (see
// useMarket.ts) — tagged with which 15m contract it belongs to. A window's
// closing tick can land anywhere (including a collapse toward 0/100 right
// at settlement) and the next window opens on a completely different
// strike, so drawing a straight line between two different tickers' points
// is misleading; consumers use this field to break the line at rollovers
// instead of connecting across them. Distinct from the raw PricePoint the
// server pushes on every live tick, which isn't tagged this way.
export type HistoryPoint = PricePoint & { ticker: string | null };

export type MarketInfo = {
  symbol: string; // "BTC", "DOGE", ...
  ticker: string;
  title: string;
  openTime: number; // unix seconds
  closeTime: number; // unix seconds
};

// Messages sent from the local backend proxy to the browser over WebSocket.
// One WebSocket carries every configured market — consumers filter by symbol.
export type ServerMessage =
  | { type: "market"; market: MarketInfo }
  | { type: "price"; symbol: string; point: PricePoint }
  | { type: "flips"; symbol: string; lastHour: number; lastWindow: number }
  | { type: "wallet"; balanceCents: number }
  | { type: "orderStatus"; symbol: string; resting: boolean; holding: boolean }
  | { type: "pnl"; symbol: string; dollars: number }
  // Paper-trading simulation: what a fixed $5-per-trade 6c-in/95c-out
  // strategy would have made against this market's real live price feed,
  // session-only — see server/simTracker.ts. Not a real trade, no bots or
  // money involved; a live read on whether current conditions look
  // favorable for actually running your bots right now.
  | {
      type: "sim";
      symbol: string;
      totalDollars: number;
      // Rolling sum of just the last hour's simulated trades, alongside the
      // session-long totalDollars — lets the card show both at once.
      lastHourDollars: number;
      wins: number;
      losses: number;
      lastTrade: {
        side: "yes" | "no";
        result: "win" | "loss";
        entryCents: number;
        profitDollars: number;
        time: number;
      } | null;
    }
  // Live BTC/USD spot price in dollars, independent of any Kalshi contract
  // — see server/spotPrice.ts. Only ever sent for symbol "BTC".
  | { type: "spot"; symbol: string; priceDollars: number }
  // Live unrealized position in the market's currently active ticker —
  // positionFp is signed (positive = net YES contracts, negative = net NO),
  // costDollars is total cost paid for it. Both 0 whenever flat.
  | { type: "position"; symbol: string; positionFp: number; costDollars: number }
  | { type: "status"; connected: boolean }
  // Fires the instant Kalshi pushes a real fill (see server/kalshiFills.ts)
  // — "entry" is a new position opening, "exit" is cashing one out. Intent
  // is derived from the fill's client_order_id, not Kalshi's own "buy"/
  // "sell" action field, which doesn't reliably distinguish the two (a
  // "sell yes at 94c" fill is economically the same trade as "buy no at
  // 6c", so it can't tell you whether this was an entry or an exit). Drives
  // the buy-in/win sounds directly off the trade itself instead of the
  // slower resting/holding poll or settlement lookup.
  | {
      type: "fillEvent";
      symbol: string;
      intent: "entry" | "exit";
      // Which side traded and at what price (0-100 cents), when known — lets
      // a consumer show/log exactly what happened, not just that something did.
      side?: "yes" | "no";
      priceCents?: number;
    };
