import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy server/.env.example to .env and fill it in.`
    );
  }
  return value;
}

export const config = {
  // REST/WS hosts, per docs.kalshi.com as of 2026-08. Kalshi has changed
  // these before (api.elections.kalshi.com / trading-api.kalshi.com were
  // both used previously) — override via .env if they move again.
  restBaseUrl: process.env.KALSHI_REST_BASE_URL ?? "https://external-api.kalshi.com",
  wsUrl: process.env.KALSHI_WS_URL ?? "wss://external-api-ws.kalshi.com/trade-api/ws/v2",

  apiKeyId: required("KALSHI_API_KEY_ID"),
  privateKeyPem: readFileSync(required("KALSHI_PRIVATE_KEY_PATH"), "utf8"),

  // Series tickers for Kalshi's 15-minute up/down markets (confirmed via
  // docs.kalshi.com and live market tickers, e.g. KXBTC15M-26JAN110930-...).
  // Each entry gets its own market-lookup + feed pair (see server/index.ts).
  markets: [
    { symbol: "BTC", seriesTicker: process.env.BTC_SERIES_TICKER ?? "KXBTC15M" },
    { symbol: "DOGE", seriesTicker: process.env.DOGE_SERIES_TICKER ?? "KXDOGE15M" },
    { symbol: "ETH", seriesTicker: process.env.ETH_SERIES_TICKER ?? "KXETH15M" },
    { symbol: "SILVER", seriesTicker: process.env.SILVER_SERIES_TICKER ?? "KXSILVER15M" },
    { symbol: "GOLD", seriesTicker: process.env.GOLD_SERIES_TICKER ?? "KXGOLD15M" },
    { symbol: "OIL", seriesTicker: process.env.OIL_SERIES_TICKER ?? "KXWTI15M" },
    { symbol: "NEAR", seriesTicker: process.env.NEAR_SERIES_TICKER ?? "KXNEAR15M" },
    { symbol: "HYPE", seriesTicker: process.env.HYPE_SERIES_TICKER ?? "KXHYPE15M" },
  ],

  // How often to re-check for a market rollover (new 15m window opening).
  marketPollIntervalMs: Number(process.env.MARKET_POLL_INTERVAL_MS ?? 15_000),

  // Local WebSocket server the React app connects to.
  localWsPort: Number(process.env.LOCAL_WS_PORT ?? 4001),
};
