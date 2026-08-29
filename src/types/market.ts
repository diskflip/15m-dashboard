export type PricePoint = {
  time: number;
  yes: number; // YES side's best bid, in cents (0-100). NO = 100 - yes.
};

// Tagged with which 15m contract it belongs to, so the chart can break the
// line at rollovers instead of connecting across them.
export type HistoryPoint = PricePoint & { ticker: string | null };

export type MarketInfo = {
  symbol: string;
  ticker: string;
  title: string;
  openTime: number;
  closeTime: number;
};

// Messages sent from the local backend proxy to the browser over WebSocket.
export type ServerMessage =
  | { type: "market"; market: MarketInfo }
  | { type: "price"; symbol: string; point: PricePoint }
  | { type: "flips"; symbol: string; lastHour: number; lastWindow: number }
  | { type: "wallet"; balanceCents: number }
  | { type: "orderStatus"; symbol: string; resting: boolean; holding: boolean }
  | { type: "pnl"; symbol: string; dollars: number }
  // Paper-trading simulation — see server/simTracker.ts.
  | {
      type: "sim";
      symbol: string;
      totalDollars: number;
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
  // Faster-cycling paper-trading variant (6c-in, 40c-out) — only a rolling
  // last-30-min figure, no session total.
  | {
      type: "sim40";
      symbol: string;
      dollars: number;
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
  | { type: "spot"; symbol: string; priceDollars: number }
  | { type: "position"; symbol: string; positionFp: number; costDollars: number }
  | { type: "status"; connected: boolean }
  | {
      type: "fillEvent";
      symbol: string;
      intent: "entry" | "exit";
      side?: "yes" | "no";
      priceCents?: number;
    };
