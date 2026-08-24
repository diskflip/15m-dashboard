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
  // Live unrealized position in the currently active ticker — signed
  // (positive = net YES contracts, negative = net NO). Both 0 when flat.
  positionFp: number;
  costDollars: number;
  // Unix-ms timestamp of the last real "sell" fill (cashing a position out)
  // — consumers can watch this to trigger a one-off "we won" animation.
  winFlash: number | null;
  // Unix-ms timestamp of the last real "buy" fill (opening/adding to a
  // position) — consumers can watch this to trigger a one-off "order
  // filled" sound/animation.
  buyInFlash: number | null;
};

// One WebSocket (see data/kalshi.ts) carries every configured market's
// messages — this hook just filters for the one symbol it cares about, so
// multiple instances (one per market) can share the same connection.
// `enabled` fully pauses this market when false: no connection, no commit
// timer, state reset to a clean slate — the toggle in the UI is a real
// resource pause, not just a hidden chart.
export function useMarket(symbol: string, enabled: boolean = true): MarketState {
  const [connected, setConnected] = useState(false);
  const [market, setMarket] = useState<MarketInfo | null>(null);
  // The rolling buffer itself lives in a ref, mutated in place (push +
  // splice), not React state — see the commit timer below for why.
  const historyRef = useRef<HistoryPoint[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [currentYes, setCurrentYes] = useState<number | null>(null);
  const [flipsLastHour, setFlipsLastHour] = useState(0);
  const [flipsLastWindow, setFlipsLastWindow] = useState(0);
  const [resting, setResting] = useState(false);
  const [holding, setHolding] = useState(false);
  const [pnlDollars, setPnlDollars] = useState(0);
  const [positionFp, setPositionFp] = useState(0);
  const [costDollars, setCostDollars] = useState(0);
  const [winFlash, setWinFlash] = useState<number | null>(null);
  const [buyInFlash, setBuyInFlash] = useState<number | null>(null);

  const currentTickerRef = useRef<string | null>(null);
  const lastYesRef = useRef<number | null>(null);

  // The chart shows a rolling 30-minute lookback that keeps going across a
  // 15m window rollover (a new Kalshi contract opening doesn't mean "start
  // over" for the purpose of eyeballing recent chop) — only a full pause
  // (enabled -> false) or a fresh page load clears it. See the commit timer
  // below for how the buffer stays cheap to maintain at this rate even with
  // several markets mounted at once.
  //
  // No client-side gap-hiding here on purpose: the rollover "drops to 0"
  // artifact this used to paper over (with a time-based freeze) is fixed at
  // the source now — see server/kalshiSocket.ts (filters out Kalshi's
  // no-resting-bid sentinel instead of treating it as a real price) and
  // server/index.ts's prepareNextMarket/scheduleSwitch (pre-subscribes the
  // next window ahead of time so there's no subscribe latency at the
  // boundary either). Every real tick the server forwards gets plotted.
  const COMMIT_INTERVAL_MS = 50;
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
      setPositionFp(0);
      setCostDollars(0);
      setWinFlash(null);
      setBuyInFlash(null);
      currentTickerRef.current = null;
      lastYesRef.current = null;
      return;
    }

    const commitTimer = setInterval(() => {
      const yes = lastYesRef.current;
      if (yes === null) return;

      const now = Date.now();
      const point: HistoryPoint = { time: now / 1000, yes, ticker: currentTickerRef.current };
      const cutoff = (now - HISTORY_WINDOW_MS) / 1000;

      // Mutate the buffer in place instead of replacing it with a new array
      // every tick. At the 30-minute cap and a fast commit interval this
      // buffer can hold tens of thousands of points — `[...prev, point]`
      // (the previous approach) copies the *entire* array on every single
      // tick just to append one element, and does that for every mounted
      // market simultaneously, forever, as long as the tab stays open. That
      // sustained allocation/GC churn is what was behind the app eventually
      // slowing down or getting killed after running for a while. push() is
      // O(1) amortized; splice() only touches the handful of points that
      // actually aged out this tick (usually 0 or 1), not the whole buffer.
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
          if (msg.market.symbol !== symbol) return;
          currentTickerRef.current = msg.market.ticker;
          setMarket(msg.market);
        } else if (msg.type === "price") {
          if (msg.symbol !== symbol) return;
          lastYesRef.current = msg.point.yes;
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

  // historyVersion isn't read directly — bumping it is what makes React
  // re-render this hook's caller so it picks up the latest in-place
  // mutation to historyRef.current below.
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
    positionFp,
    costDollars,
    winFlash,
    buyInFlash,
  };
}
