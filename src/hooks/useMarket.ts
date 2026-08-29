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
  // Paper-trading simulation totals — see server/simTracker.ts.
  simDollars: number;
  simLastHourDollars: number;
  simWins: number;
  simLosses: number;
  simFlash: { time: number; result: "win" | "loss" } | null;
  // Faster-cycling paper-trading variant (6c-in, 40c-out) — only a rolling
  // last-30-min figure, no session total.
  sim40Dollars: number;
  sim40Wins: number;
  sim40Losses: number;
  sim40Flash: { time: number; result: "win" | "loss" } | null;
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
  const [simDollars, setSimDollars] = useState(0);
  const [simLastHourDollars, setSimLastHourDollars] = useState(0);
  const [simWins, setSimWins] = useState(0);
  const [simLosses, setSimLosses] = useState(0);
  const [simFlash, setSimFlash] = useState<{ time: number; result: "win" | "loss" } | null>(null);
  const [sim40Dollars, setSim40Dollars] = useState(0);
  const [sim40Wins, setSim40Wins] = useState(0);
  const [sim40Losses, setSim40Losses] = useState(0);
  const [sim40Flash, setSim40Flash] = useState<{ time: number; result: "win" | "loss" } | null>(null);
  const [positionFp, setPositionFp] = useState(0);
  const [costDollars, setCostDollars] = useState(0);
  const [winFlash, setWinFlash] = useState<number | null>(null);
  const [buyInFlash, setBuyInFlash] = useState<number | null>(null);
  const [spotPriceDollars, setSpotPriceDollars] = useState<number | null>(null);

  const currentTickerRef = useRef<string | null>(null);
  const lastYesRef = useRef<number | null>(null);
  // A "sim" message replays the tracker's full snapshot on every reconnect,
  // so dedupe against the last-seen trade time before flashing.
  const lastSimTradeTimeRef = useRef<number | null>(null);
  const lastSim40TradeTimeRef = useRef<number | null>(null);

  // Rolling 30-minute chart lookback, kept across a 15m rollover — only a
  // pause or page reload clears it.
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
      setSimDollars(0);
      setSimLastHourDollars(0);
      setSimWins(0);
      setSimLosses(0);
      setSimFlash(null);
      setSim40Dollars(0);
      setSim40Wins(0);
      setSim40Losses(0);
      setSim40Flash(null);
      setPositionFp(0);
      setCostDollars(0);
      setWinFlash(null);
      setBuyInFlash(null);
      setSpotPriceDollars(null);
      currentTickerRef.current = null;
      lastYesRef.current = null;
      lastSimTradeTimeRef.current = null;
      lastSim40TradeTimeRef.current = null;
      return;
    }

    const commitTimer = setInterval(() => {
      const yes = lastYesRef.current;
      if (yes === null) return;

      const now = Date.now();
      const point: HistoryPoint = { time: now / 1000, yes, ticker: currentTickerRef.current };
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
        } else if (msg.type === "sim") {
          if (msg.symbol !== symbol) return;
          setSimDollars(msg.totalDollars);
          setSimLastHourDollars(msg.lastHourDollars);
          setSimWins(msg.wins);
          setSimLosses(msg.losses);
          if (msg.lastTrade && msg.lastTrade.time !== lastSimTradeTimeRef.current) {
            lastSimTradeTimeRef.current = msg.lastTrade.time;
            setSimFlash({ time: Date.now(), result: msg.lastTrade.result });
          }
        } else if (msg.type === "sim40") {
          if (msg.symbol !== symbol) return;
          setSim40Dollars(msg.dollars);
          setSim40Wins(msg.wins);
          setSim40Losses(msg.losses);
          if (msg.lastTrade && msg.lastTrade.time !== lastSim40TradeTimeRef.current) {
            lastSim40TradeTimeRef.current = msg.lastTrade.time;
            setSim40Flash({ time: Date.now(), result: msg.lastTrade.result });
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
    simDollars,
    simLastHourDollars,
    simWins,
    simLosses,
    simFlash,
    sim40Dollars,
    sim40Wins,
    sim40Losses,
    sim40Flash,
    positionFp,
    costDollars,
    winFlash,
    buyInFlash,
    spotPriceDollars,
  };
}
