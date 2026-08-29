import { signRequest } from "./kalshiAuth.ts";
import { config } from "./config.ts";

type KalshiMarket = {
  ticker: string;
  yes_sub_title?: string;
  status: string;
  open_time: string;
  close_time: string;
};

export type CurrentMarket = {
  ticker: string;
  title: string;
  openTime: number;
  closeTime: number;
};

const MARKETS_PATH = "/trade-api/v2/markets";

async function fetchMarkets(
  seriesTicker: string,
  status: "open" | "unopened",
  limit: number
): Promise<CurrentMarket[]> {
  const query = `?series_ticker=${seriesTicker}&status=${status}&limit=${limit}`;
  const headers = {
    ...signRequest("GET", MARKETS_PATH),
    Accept: "application/json",
  };

  const res = await fetch(`${config.restBaseUrl}${MARKETS_PATH}${query}`, {
    headers,
  });

  if (!res.ok) {
    throw new Error(
      `Kalshi markets lookup failed: ${res.status} ${await res.text()}`
    );
  }

  const body = (await res.json()) as { markets: KalshiMarket[] };
  return body.markets.map((m) => ({
    ticker: m.ticker,
    title: m.yes_sub_title ?? m.ticker,
    openTime: Date.parse(m.open_time),
    closeTime: Date.parse(m.close_time),
  }));
}

export async function findCurrentMarket(
  seriesTicker: string
): Promise<CurrentMarket | null> {
  const now = Date.now();
  const candidates = (await fetchMarkets(seriesTicker, "open", 50))
    .filter((m) => m.openTime <= now && now < m.closeTime)
    .sort((a, b) => a.closeTime - b.closeTime);
  return candidates[0] ?? null;
}

// Kalshi pre-creates a day's worth of windows in advance, so the next one
// is knowable before the current window closes.
export async function findNextMarket(
  seriesTicker: string,
  afterMs: number
): Promise<CurrentMarket | null> {
  const candidates = (await fetchMarkets(seriesTicker, "unopened", 200))
    .filter((m) => m.openTime >= afterMs)
    .sort((a, b) => a.openTime - b.openTime);
  return candidates[0] ?? null;
}
