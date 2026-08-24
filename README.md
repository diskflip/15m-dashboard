# Flip Monitor (V1 — BTC 15m)

Realtime chart of Kalshi's BTC 15-minute market: YES and NO executable ask
prices, plotted live, with your 6¢/85¢ entry/exit levels marked.

## Architecture

- `src/` — React + Vite + TypeScript frontend. Only talks to the local
  backend over WebSocket; never touches Kalshi directly.
- `server/` — tiny Node backend. Finds the current BTC 15m market, holds the
  authenticated Kalshi WebSocket connection, maintains the orderbook, derives
  YES/NO asks, and rebroadcasts `{ time, yes, no }` to the browser. Kalshi
  credentials live only here.

```
src/
  components/MarketChart.tsx   generic { time, yes, no } chart — reusable per market
  data/kalshi.ts                WebSocket client for the local backend
  hooks/useBTCMarket.ts         chart state: history, current prices, range
  types/market.ts                shared PricePoint / MarketInfo types
server/
  index.ts                      entry point: polling + local WS broadcast
  kalshiSocket.ts                Kalshi WebSocket connection + orderbook feed
  kalshiAuth.ts                  RSA-PSS request signing
  findMarket.ts                  REST lookup of the current open BTC 15m market
  orderbook.ts                   best-bid tracking, ask derivation
  config.ts                      env var loading
```

## Setup

1. Create a Kalshi API key (Kalshi account → Settings → API Keys). Download
   the private key file it gives you and save it somewhere in this project,
   e.g. `server/kalshi-private-key.pem` (already gitignored).
2. Copy the env template and fill in your key ID and key path:
   ```
   cp server/.env.example .env
   ```
3. `BTC_SERIES_TICKER` defaults to `KXBTC15M` (confirmed against
   docs.kalshi.com and live market tickers). If the app logs "no open BTC
   15m market found", double check it against
   `https://external-api.kalshi.com/trade-api/v2/series?category=Crypto`
   or the Kalshi site.
4. Install dependencies (already done if you're reading this after setup):
   ```
   npm install
   ```
5. Run both the frontend and backend:
   ```
   npm run dev
   ```
   Frontend: http://localhost:5173 — Backend WS: ws://localhost:4001

## Notes

- YES/NO prices are **executable asks**, derived from the opposite side's
  best bid (`yesAsk = 100 - bestNoBid`, `noAsk = 100 - bestYesBid`), not last
  trade price — last trade can be stale in thin markets.
- When the current 15m market closes and a new one opens, the backend
  detects it (polling Kalshi's REST API every 15s) and the chart resets.
- To add another market (DOGE, ETH, ...) later: reuse `MarketChart` as-is,
  add a new backend market-lookup + feed pair (or generalize the existing
  one to take a ticker/series param), and a new hook mirroring
  `useBTCMarket`.
