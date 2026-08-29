import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { MARKETS } from "../markets.config.ts";

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
  restBaseUrl: process.env.KALSHI_REST_BASE_URL ?? "https://external-api.kalshi.com",
  wsUrl: process.env.KALSHI_WS_URL ?? "wss://external-api-ws.kalshi.com/trade-api/ws/v2",

  apiKeyId: required("KALSHI_API_KEY_ID"),
  privateKeyPem: readFileSync(required("KALSHI_PRIVATE_KEY_PATH"), "utf8"),

  markets: MARKETS.filter((m) => m.enabled),

  marketPollIntervalMs: Number(process.env.MARKET_POLL_INTERVAL_MS ?? 15_000),
  localWsPort: Number(process.env.LOCAL_WS_PORT ?? 4001),
};
