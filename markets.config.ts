export type Market = {
  symbol: string;
  seriesTicker: string;
  enabled: boolean;
};

// Add, remove, or toggle markets here. Both the backend (server/config.ts)
// and frontend (src/App.tsx) read from this one list, in this order — the
// frontend renders it as-is, with no further sorting or reordering.
export const MARKETS: Market[] = [
  { symbol: "BTC", seriesTicker: "KXBTC15M", enabled: true },
  { symbol: "ETH", seriesTicker: "KXETH15M", enabled: true },
  { symbol: "DOGE", seriesTicker: "KXDOGE15M", enabled: true },
  { symbol: "HYPE", seriesTicker: "KXHYPE15M", enabled: true },
  { symbol: "NEAR", seriesTicker: "KXNEAR15M", enabled: true },
  { symbol: "SILVER", seriesTicker: "KXSILVER15M", enabled: true },
  // GOLD and OIL don't trade on weekends.
  { symbol: "GOLD", seriesTicker: "KXGOLD15M", enabled: false },
  { symbol: "OIL", seriesTicker: "KXWTI15M", enabled: false },
];
