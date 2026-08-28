import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.ts";
import { findCurrentMarket, findNextMarket, type CurrentMarket } from "./findMarket.ts";
import { KalshiFeed } from "./kalshiSocket.ts";
import { KalshiFillsFeed, type PositionUpdate } from "./kalshiFills.ts";
import { FlipTracker } from "./flipTracker.ts";
import { PnlTracker } from "./pnlTracker.ts";
import { SimTracker } from "./simTracker.ts";
import { startBtcSpotFeed } from "./spotPrice.ts";
import {
  fetchPortfolioSnapshot,
  fetchTickerRealizedPnl,
  fetchTodaysRealizedPnlBySeries,
  type PortfolioSnapshot,
} from "./portfolio.ts";
import { getPnlSince, resetPnlNow } from "./pnlReset.ts";

// The only job of this process: for each configured market (BTC, DOGE, ...),
// find the live 15m Kalshi market, subscribe to Kalshi's `ticker` feed for
// it, and forward simplified { symbol, time, yes } points (yes = YES bid,
// in cents) to the browser over a local WebSocket, along with flip counts
// (see flipTracker.ts), session P&L (see pnlTracker.ts), and account state
// (see portfolio.ts — read-only, never places or modifies orders). Kalshi
// credentials never leave this process.

const wss = new WebSocketServer({ port: config.localWsPort });
const FLIPS_REBROADCAST_MS = 10_000;
const PORTFOLIO_POLL_MS = 5_000;

let lastPortfolio: PortfolioSnapshot | null = null;
let lastBtcSpotDollars: number | null = null;

function broadcast(message: unknown) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function marketMessage(symbol: string, market: CurrentMarket) {
  return {
    type: "market",
    market: {
      symbol,
      ticker: market.ticker,
      title: market.title,
      openTime: Math.floor(market.openTime / 1000),
      closeTime: Math.floor(market.closeTime / 1000),
    },
  };
}

function flipsMessage(symbol: string, flips: FlipTracker) {
  return {
    type: "flips",
    symbol,
    lastHour: flips.countLastHour(),
    lastWindow: flips.countLastCompletedWindow(),
  };
}

function walletMessage(balanceCents: number) {
  return { type: "wallet", balanceCents };
}

function orderStatusMessage(
  symbol: string,
  ticker: string | undefined,
  snapshot: PortfolioSnapshot
) {
  return {
    type: "orderStatus",
    symbol,
    resting: ticker !== undefined && snapshot.restingTickers.has(ticker),
    holding: ticker !== undefined && snapshot.holdingTickers.has(ticker),
  };
}

function pnlMessage(symbol: string, pnl: PnlTracker) {
  return { type: "pnl", symbol, dollars: pnl.total() };
}

function simMessage(symbol: string, sim: SimTracker) {
  const snap = sim.snapshot();
  return {
    type: "sim",
    symbol,
    totalDollars: snap.totalDollars,
    lastHourDollars: snap.windowDollars,
    wins: snap.wins,
    losses: snap.losses,
    lastTrade: snap.lastTrade,
  };
}

// Faster-cycling variant of the same paper-trading idea: 6c-in, 40c-out
// instead of 95c — exits earlier for a smaller, more frequent profit. Only
// the rolling last-30-minutes figure matters here (no session total shown),
// since the point is a quick read on how the last half hour specifically
// has looked, side by side with the slower 95c-exit figure.
function sim40Message(symbol: string, sim: SimTracker) {
  const snap = sim.snapshot();
  return {
    type: "sim40",
    symbol,
    dollars: snap.windowDollars,
    wins: snap.wins,
    losses: snap.losses,
    lastTrade: snap.lastTrade,
  };
}

function spotMessage(symbol: string, priceDollars: number) {
  return { type: "spot", symbol, priceDollars };
}

function positionMessage(symbol: string, position: OpenPosition | null) {
  return {
    type: "position",
    symbol,
    positionFp: position?.positionFp ?? 0,
    costDollars: position?.costDollars ?? 0,
  };
}

type TrackedMarket = {
  symbol: string;
  seriesTicker: string;
  active: CurrentMarket | null;
  // The ticker that just rolled over out of `active` — fills for a window
  // can keep trickling in briefly after the next window opens (Kalshi
  // processes trades slightly behind the boundary), so matching needs to
  // check this too or those trailing fills silently match nothing.
  previousTicker: string | null;
  // The next window, pre-fetched well before it opens (Kalshi schedules a
  // whole day's markets in advance, so its ticker is knowable ahead of
  // time) so the feed can already be subscribed to it before the actual
  // rollover — see prepareNextMarket/scheduleSwitch below.
  nextKnown: CurrentMarket | null;
  feed: KalshiFeed;
  flips: FlipTracker;
  pnl: PnlTracker;
  sim: SimTracker;
  sim40: SimTracker;
  // Live unrealized position in `active`, from the private market_positions
  // push — null whenever flat. Cleared on every market switch since it's
  // scoped to one ticker, not carried across windows.
  position: OpenPosition | null;
};

type OpenPosition = { positionFp: number; costDollars: number };

const trackedMarkets: TrackedMarket[] = config.markets.map(({ symbol, seriesTicker }) => {
  const flips = new FlipTracker();
  const sim = new SimTracker();
  const sim40 = new SimTracker(6, 40, 5, 30 * 60);
  const feed = new KalshiFeed(({ yes }) => {
    broadcast({
      type: "price",
      symbol,
      point: { time: Math.floor(Date.now() / 1000), yes },
    });
    if (flips.onPrice(yes)) {
      broadcast(flipsMessage(symbol, flips));
    }
    if (sim.onPrice(yes)) {
      broadcast(simMessage(symbol, sim));
    }
    if (sim40.onPrice(yes)) {
      broadcast(sim40Message(symbol, sim40));
    }
  });
  feed.start();
  return {
    symbol,
    seriesTicker,
    active: null,
    previousTicker: null,
    nextKnown: null,
    feed,
    flips,
    pnl: new PnlTracker(),
    sim,
    sim40,
    position: null,
  };
});

// Real (not simulated) daily P&L, cleared on demand from the UI — see
// pnlReset.ts. Moves the "since" cutoff to now (persisted, survives a
// restart) and zeroes every market's in-memory session total immediately so
// the UI reflects $0 without needing a server restart, which would also
// wipe unrelated in-memory state (paper-sim totals, flip counts) that
// wasn't asked to be cleared.
function resetTodaysPnl() {
  resetPnlNow();
  for (const market of trackedMarkets) {
    market.pnl.reset();
    broadcast(pnlMessage(market.symbol, market.pnl));
  }
  console.log("[pnl] reset for the day");
}

// Paper-trading sim totals — separate from the real P&L reset above (see its
// comment): only clears when explicitly asked for, not bundled by default.
function resetTodaysSim() {
  for (const market of trackedMarkets) {
    market.sim.reset();
    market.sim40.reset();
    broadcast(simMessage(market.symbol, market.sim));
    broadcast(sim40Message(market.symbol, market.sim40));
  }
  console.log("[sim] reset for the day");
}

wss.on("connection", (client) => {
  client.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg?.cmd === "resetPnl") resetTodaysPnl();
    if (msg?.cmd === "resetSim") resetTodaysSim();
  });

  client.send(JSON.stringify({ type: "status", connected: true }));
  for (const market of trackedMarkets) {
    if (market.active) {
      client.send(JSON.stringify(marketMessage(market.symbol, market.active)));
    }
    client.send(JSON.stringify(flipsMessage(market.symbol, market.flips)));
    client.send(JSON.stringify(pnlMessage(market.symbol, market.pnl)));
    client.send(JSON.stringify(simMessage(market.symbol, market.sim)));
    client.send(JSON.stringify(sim40Message(market.symbol, market.sim40)));
    client.send(JSON.stringify(positionMessage(market.symbol, market.position)));
  }
  if (lastPortfolio) {
    client.send(JSON.stringify(walletMessage(lastPortfolio.balanceCents)));
    for (const market of trackedMarkets) {
      client.send(
        JSON.stringify(orderStatusMessage(market.symbol, market.active?.ticker, lastPortfolio))
      );
    }
  }
  if (lastBtcSpotDollars !== null) {
    client.send(JSON.stringify(spotMessage("BTC", lastBtcSpotDollars)));
  }
});

function applyMarketSwitch(market: TrackedMarket, found: CurrentMarket) {
  console.log(`[market-poll] ${market.symbol} switching to ${found.ticker}`);
  const closingTicker = market.active?.ticker;
  market.previousTicker = closingTicker ?? null;
  market.active = found;
  market.position = null;
  // Already subscribed (see prepareNextMarket) in the normal case — this is
  // a no-op then. Only actually opens a fresh subscription on the fallback
  // path (verifySwitch / the safety-net poll finding a switch we didn't see
  // coming).
  market.feed.promote(found.ticker);
  market.flips.onMarketChange(found.ticker);
  market.sim.onMarketChange(found.ticker);
  market.sim40.onMarketChange(found.ticker);
  if (closingTicker) settleClosedWindow(market, closingTicker);
  broadcast(marketMessage(market.symbol, found));
  broadcast(flipsMessage(market.symbol, market.flips));
  broadcast(simMessage(market.symbol, market.sim));
  broadcast(sim40Message(market.symbol, market.sim40));
  broadcast(positionMessage(market.symbol, null));
  if (lastPortfolio) {
    broadcast(orderStatusMessage(market.symbol, found.ticker, lastPortfolio));
  }
}

// Kalshi pre-creates a whole day's worth of windows in advance (confirmed
// live via the API: the next several hours of a series' markets already
// exist under status=unopened well before their own open_time) — so instead
// of discovering the next ticker only after the current one has already
// closed (which is what used to cause rollover lag/gaps), fetch it well
// ahead of time and pre-subscribe the feed to it. The actual switch then
// just flips which already-flowing subscription is "active", anchored
// precisely to the known close time — no REST round-trip sits on the
// critical path at the moment of rollover.
async function prepareNextMarket(market: TrackedMarket) {
  if (!market.active) return;
  try {
    const next = await findNextMarket(market.seriesTicker, market.active.closeTime);
    if (!next) {
      console.warn(`[market-poll] ${market.symbol} no upcoming market found after ${market.active.ticker}`);
      return;
    }
    market.nextKnown = next;
    market.feed.ensureSubscribed(next.ticker);
    scheduleSwitch(market, market.active.closeTime);
  } catch (err) {
    console.error(`[market-poll] ${market.symbol} next-market lookup failed:`, (err as Error).message);
  }
}

// Small buffer past the exact close boundary — cheap insurance against
// minor clock skew between this process and Kalshi's, not a wait for
// anything to happen.
const SWITCH_EPSILON_MS = 250;
// A pre-fetched schedule could in principle be wrong (e.g. an early close
// via can_close_early) — re-verify against Kalshi's own data shortly after
// every switch as a safety net, without that check ever sitting on the
// critical path of the switch itself.
const SWITCH_VERIFY_DELAY_MS = 2_000;

function scheduleSwitch(market: TrackedMarket, closeTimeMs: number) {
  const delay = Math.max(0, closeTimeMs - Date.now() + SWITCH_EPSILON_MS);
  setTimeout(() => {
    // Something else already moved this market on (e.g. the safety-net
    // poll beat us to it) — nothing left to do here. Multiple scheduled
    // switches for the same market can stack up harmlessly this way; only
    // the first to fire ever actually applies.
    if (market.active?.closeTime !== closeTimeMs) return;

    const next = market.nextKnown;
    if (next && next.ticker !== market.active?.ticker) {
      applyMarketSwitch(market, next);
      prepareNextMarket(market);
      setTimeout(() => verifySwitch(market), SWITCH_VERIFY_DELAY_MS);
    } else {
      // Didn't have a next market lined up in time (shouldn't normally
      // happen) — fall back to a real-time lookup.
      verifySwitch(market);
    }
  }, delay);
}

async function verifySwitch(market: TrackedMarket) {
  try {
    const found = await findCurrentMarket(market.seriesTicker);
    if (found && found.ticker !== market.active?.ticker) {
      applyMarketSwitch(market, found);
      prepareNextMarket(market);
    }
  } catch (err) {
    console.error(`[market-poll] ${market.symbol} verify lookup failed:`, (err as Error).message);
  }
}

async function pollForCurrentMarket(market: TrackedMarket) {
  try {
    const found = await findCurrentMarket(market.seriesTicker);
    if (!found) {
      console.warn(`[market-poll] no open ${market.symbol} 15m market found`);
      return;
    }
    if (found.ticker !== market.active?.ticker) {
      applyMarketSwitch(market, found);
    }
    // Only (re)fetch/schedule if nothing is lined up yet — the normal path
    // already keeps this chain going via applyMarketSwitch -> prepareNextMarket
    // above; this is purely a safety net for a chain that somehow broke.
    if (!market.nextKnown) prepareNextMarket(market);
  } catch (err) {
    console.error(`[market-poll] ${market.symbol} lookup failed:`, (err as Error).message);
  }
}

for (const market of trackedMarkets) {
  pollForCurrentMarket(market);
  setInterval(() => pollForCurrentMarket(market), config.marketPollIntervalMs);
}

// Flip counts can go stale with no new events (the "last hour" window
// keeps sliding forward even when nothing new happens) — rebroadcast
// periodically so the UI count doesn't lag reality.
setInterval(() => {
  for (const market of trackedMarkets) {
    broadcast(flipsMessage(market.symbol, market.flips));
  }
}, FLIPS_REBROADCAST_MS);

async function pollPortfolio() {
  try {
    const snapshot = await fetchPortfolioSnapshot();
    lastPortfolio = snapshot;
    broadcast(walletMessage(snapshot.balanceCents));
    for (const market of trackedMarkets) {
      broadcast(orderStatusMessage(market.symbol, market.active?.ticker, snapshot));
    }
  } catch (err) {
    console.error("[portfolio-poll] failed:", (err as Error).message);
  }
}

// Kalshi posts a window's settlement a few seconds after it closes, not
// instantly — retry with backoff rather than giving up on the first miss.
const SETTLEMENT_RETRY_MS = 4_000;
const SETTLEMENT_MAX_ATTEMPTS = 6;

async function settleClosedWindow(market: TrackedMarket, ticker: string, attempt = 0) {
  try {
    const dollars = await fetchTickerRealizedPnl(ticker);
    if (dollars === null) {
      if (attempt < SETTLEMENT_MAX_ATTEMPTS) {
        setTimeout(() => settleClosedWindow(market, ticker, attempt + 1), SETTLEMENT_RETRY_MS);
      } else {
        console.warn(`[pnl] ${market.symbol} ${ticker} never showed up as settled`);
      }
      return;
    }
    market.pnl.add(dollars);
    broadcast(pnlMessage(market.symbol, market.pnl));
  } catch (err) {
    console.error(`[pnl] ${market.symbol} settlement lookup failed:`, (err as Error).message);
  }
}

pollPortfolio();
setInterval(pollPortfolio, PORTFOLIO_POLL_MS);

// Seed each market's session P&L from everything already settled since the
// current reset point (normally UTC midnight, movable via pnlReset.ts), so
// a process restart (e.g. every `tsx watch` reload) doesn't reset the
// on-screen total back to zero — see fetchTodaysRealizedPnlBySeries.
async function seedTodaysPnl() {
  try {
    const since = getPnlSince();
    const bySeries = await fetchTodaysRealizedPnlBySeries(since);
    for (const market of trackedMarkets) {
      const seed = bySeries.get(market.seriesTicker);
      if (seed) {
        market.pnl.add(seed);
        broadcast(pnlMessage(market.symbol, market.pnl));
      }
    }
    console.log(`[pnl] seeded realized P&L since ${since.toISOString()}:`, Object.fromEntries(bySeries));
  } catch (err) {
    console.error("[pnl] failed to seed today's P&L:", (err as Error).message);
  }
}
seedTodaysPnl();

// Fills push instantly over Kalshi's private `fill` channel — this drives
// both the resting/holding badge (optimistic update here, corrected by the
// next pollPortfolio() shortly after regardless) and the buy-in/win sounds
// directly off the fill's own client_order_id-derived intent (see
// kalshiFills.ts — NOT Kalshi's "buy"/"sell" action field, which doesn't
// reliably distinguish entry from exit), not off polled state or a
// settlement lookup that can lag minutes behind the actual trade.
const fillsFeed = new KalshiFillsFeed(
  ({ ticker, intent, side, priceCents }) => {
    const market = trackedMarkets.find(
      (m) => m.active?.ticker === ticker || m.previousTicker === ticker
    );
    if (!market) {
      console.warn(`[fills] ${ticker} doesn't match any tracked market's active ticker`);
      return;
    }
    if (lastPortfolio) {
      lastPortfolio.holdingTickers.add(ticker);
      broadcast(orderStatusMessage(market.symbol, ticker, lastPortfolio));
    }
    if (intent === "entry" || intent === "exit") {
      console.log(
        `[fills] broadcasting fillEvent ${market.symbol} ${intent} ${side ?? "?"} @ ${priceCents ?? "?"}c`
      );
      broadcast({ type: "fillEvent", symbol: market.symbol, intent, side, priceCents });
    }
  },
  (update: PositionUpdate) => {
    // Only the currently active ticker's position is worth showing —
    // there's no live price left to mark a just-closed window's leftover
    // position against.
    const market = trackedMarkets.find((m) => m.active?.ticker === update.ticker);
    if (!market) return;
    market.position =
      update.positionFp === 0
        ? null
        : { positionFp: update.positionFp, costDollars: update.costDollars };
    broadcast(positionMessage(market.symbol, market.position));
  }
);
fillsFeed.start();

startBtcSpotFeed((dollars) => {
  lastBtcSpotDollars = dollars;
  broadcast(spotMessage("BTC", dollars));
});

console.log(`[flip-monitor] local WS server listening on :${config.localWsPort}`);
