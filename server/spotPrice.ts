// Live BTC/USD spot price, independent of Kalshi entirely — the ticker feed
// only gives the YES contract's price (a probability, 0-100c), not the
// actual underlying dollar price the 15m markets are struck against. Polls
// Coinbase's public spot-price endpoint (no auth/key needed) since Kalshi's
// API doesn't expose the underlying index itself.
const SPOT_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const SPOT_POLL_MS = 5_000;

export function startBtcSpotFeed(onPrice: (dollars: number) => void) {
  async function poll() {
    try {
      const res = await fetch(SPOT_URL);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const body = (await res.json()) as { data: { amount: string } };
      const dollars = parseFloat(body.data.amount);
      if (!Number.isNaN(dollars)) onPrice(dollars);
    } catch (err) {
      console.error("[spot-price] BTC lookup failed:", (err as Error).message);
    }
  }
  poll();
  setInterval(poll, SPOT_POLL_MS);
}
