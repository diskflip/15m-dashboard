import { useEffect, useRef, useState } from "react";
import { connectToBackend } from "../data/kalshi";
import type { HistoryPoint, MarketInfo } from "../types/market";

export type MarketState = {
  connected: boolean;
  market: MarketInfo | null;
  history: HistoryPoint[];
  currentYes: number | null;
  flipsLastHour: number;
  flipsLastWindow: number;
  resting: boolean;
  holding: boolean;
  pnlDollars: number;
  // Paper-trading simulation — see server/simTracker.ts. Both run the same
  // 6c-in/50c-out strategy; only the rolling window differs.
  sim1hDollars: number;
  sim1hWins: number;
  sim1hLosses: number;
  sim1hFlash: { time: number; result: "win" | "loss" } | null;
  sim30mDollars: number;
  sim30mWins: number;
  sim30mLosses: number;
  sim30mFlash: { time: number; result: "win" | "loss" } | null;
  // Signed: positive = net YES contracts, negative = net NO. Both 0 when flat.
  positionFp: number;
  costDollars: number;
  winFlash: number | null;
  buyInFlash: number | null;
  spotPriceDollars: number | null;
};

// One WebSocket (see data/kalshi.ts) carries every market's messages; this
// hook filters for one symbol. `enabled` fully pauses it: no connection, no
// commit timer, state reset to a clean slate.
export function useMarket(symbol: string, enabled: boolean = true): MarketState {
  const [connected, setConnected] = useState(false);
  const [market, setMarket] = useState<MarketInfo | null>(null);
  // Mutated in place (push + splice), not React state — see the commit
  // timer below.
  const historyRef = useRef<HistoryPoint[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [currentYes, setCurrentYes] = useState<number | null>(null);
  const [flipsLastHour, setFlipsLastHour] = useState(0);
  const [flipsLastWindow, setFlipsLastWindow] = useState(0);
  const [resting, setResting] = useState(false);
  const [holding, setHolding] = useState(false);
  const [pnlDollars, setPnlDollars] = useState(0);
  const [sim1hDollars, setSim1hDollars] = useState(0);
  const [sim1hWins, setSim1hWins] = useState(0);
  const [sim1hLosses, setSim1hLosses] = useState(0);
  const [sim1hFlash, setSim1hFlash] = useState<{ time: number; result: "win" | "loss" } | null>(null);
  const [sim30mDollars, setSim30mDollars] = useState(0);
  const [sim30mWins, setSim30mWins] = useState(0);
  const [sim30mLosses, setSim30mLosses] = useState(0);
  const [sim30mFlash, setSim30mFlash] = useState<{ time: number; result: "win" | "loss" } | null>(null);
  const [positionFp, setPositionFp] = useState(0);
  const [costDollars, setCostDollars] = useState(0);
  const [winFlash, setWinFlash] = useState<number | null>(null);
  const [buyInFlash, setBuyInFlash] = useState<number | null>(null);
  const [spotPriceDollars, setSpotPriceDollars] = useState<number | null>(null);

  const currentTickerRef = useRef<string | null>(null);
  // Ticker is captured when the price arrives, not read fresh off
  // currentTickerRef at commit time — a market switch can land between a
  // ticker's last real price tick and the next 50ms commit, and re-tagging
  // that stale, pre-switch price with the new ticker would splice it into
  // the new market's line segment instead of the old one, drawing a
  // spurious connecting line across the rollover instead of a clean break.
  const lastPriceRef = useRef<{ yes: number; ticker: string | null } | null>(null);
  // A sim message replays the tracker's full snapshot on every reconnect,
  // so dedupe against the last-seen trade time before flashing.
  const lastSim1hTradeTimeRef = useRef<number | null>(null);
  const lastSim30mTradeTimeRef = useRef<number | null>(null);

  // Rolling 30-minute chart lookback, kept across a 15m rollover — only a
  // pause or page reload clears it.
  const COMMIT_INTERVAL_MS = 16;
  const HISTORY_WINDOW_MS = 30 * 60 * 1000;

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setMarket(null);
      historyRef.current = [];
      setHistoryVersion((v) => v + 1);
      setCurrentYes(null);
      setFlipsLastHour(0);
      setFlipsLastWindow(0);
      setResting(false);
      setHolding(false);
      setPnlDollars(0);
      setSim1hDollars(0);
      setSim1hWins(0);
      setSim1hLosses(0);
      setSim1hFlash(null);
      setSim30mDollars(0);
      setSim30mWins(0);
      setSim30mLosses(0);
      setSim30mFlash(null);
      setPositionFp(0);
      setCostDollars(0);
      setWinFlash(null);
      setBuyInFlash(null);
      setSpotPriceDollars(null);
      currentTickerRef.current = null;
      lastPriceRef.current = null;
      lastSim1hTradeTimeRef.current = null;
      lastSim30mTradeTimeRef.current = null;
      return;
    }

    const commitTimer = setInterval(() => {
      const last = lastPriceRef.current;
      if (last === null) return;

      const now = Date.now();
      const point: HistoryPoint = { time: now / 1000, yes: last.yes, ticker: last.ticker };
      const cutoff = (now - HISTORY_WINDOW_MS) / 1000;

      // In-place push+splice, not `[...prev, point]` — this buffer can hold
      // tens of thousands of points and a full-array copy every tick adds
      // up fast across several mounted markets.
      const arr = historyRef.current;
      arr.push(point);
      let staleCount = 0;
      while (staleCount < arr.length && arr[staleCount].time < cutoff) staleCount++;
      if (staleCount > 0) arr.splice(0, staleCount);

      setCurrentYes(point.yes);
      setHistoryVersion((v) => v + 1);
    }, COMMIT_INTERVAL_MS);

    const disconnect = connectToBackend(
      (msg) => {
        if (msg.type === "market") {
          if (msg.symbol !== symbol) return;
          currentTickerRef.current = msg.market?.ticker ?? null;
          setMarket(msg.market);
        } else if (msg.type === "price") {
          if (msg.symbol !== symbol) return;
          lastPriceRef.current = { yes: msg.point.yes, ticker: currentTickerRef.current };
        } else if (msg.type === "flips") {
          if (msg.symbol !== symbol) return;
          setFlipsLastHour(msg.lastHour);
          setFlipsLastWindow(msg.lastWindow);
        } else if (msg.type === "orderStatus") {
          if (msg.symbol !== symbol) return;
          setResting(msg.resting);
          setHolding(msg.holding);
        } else if (msg.type === "pnl") {
          if (msg.symbol !== symbol) return;
          setPnlDollars(msg.dollars);
        } else if (msg.type === "sim1h") {
          if (msg.symbol !== symbol) return;
          setSim1hDollars(msg.dollars);
          setSim1hWins(msg.wins);
          setSim1hLosses(msg.losses);
          if (msg.lastTrade && msg.lastTrade.time !== lastSim1hTradeTimeRef.current) {
            lastSim1hTradeTimeRef.current = msg.lastTrade.time;
            setSim1hFlash({ time: Date.now(), result: msg.lastTrade.result });
          }
        } else if (msg.type === "sim30m") {
          if (msg.symbol !== symbol) return;
          setSim30mDollars(msg.dollars);
          setSim30mWins(msg.wins);
          setSim30mLosses(msg.losses);
          if (msg.lastTrade && msg.lastTrade.time !== lastSim30mTradeTimeRef.current) {
            lastSim30mTradeTimeRef.current = msg.lastTrade.time;
            setSim30mFlash({ time: Date.now(), result: msg.lastTrade.result });
          }
        } else if (msg.type === "spot") {
          if (msg.symbol !== symbol) return;
          setSpotPriceDollars(msg.priceDollars);
        } else if (msg.type === "position") {
          if (msg.symbol !== symbol) return;
          setPositionFp(msg.positionFp);
          setCostDollars(msg.costDollars);
        } else if (msg.type === "fillEvent") {
          if (msg.symbol !== symbol) return;
          if (msg.intent === "entry") setBuyInFlash(Date.now());
          else if (msg.intent === "exit") setWinFlash(Date.now());
        } else if (msg.type === "status") {
          setConnected(msg.connected);
        }
      },
      (connected) => setConnected(connected)
    );

    return () => {
      clearInterval(commitTimer);
      disconnect();
    };
  }, [symbol, enabled]);

  // Bumping this triggers a re-render to pick up the in-place mutation to
  // historyRef.current above; the value itself is never read.
  void historyVersion;

  return {
    connected,
    market,
    history: historyRef.current,
    currentYes,
    flipsLastHour,
    flipsLastWindow,
    resting,
    holding,
    pnlDollars,
    sim1hDollars,
    sim1hWins,
    sim1hLosses,
    sim1hFlash,
    sim30mDollars,
    sim30mWins,
    sim30mLosses,
    sim30mFlash,
    positionFp,
    costDollars,
    winFlash,
    buyInFlash,
    spotPriceDollars,
  };
}
