import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { MarketCard } from "./components/MarketCard";
import { Countdown } from "./components/Countdown";
import { ActivityLog } from "./components/ActivityLog";
import { useWallet } from "./hooks/useWallet";
import { sendToBackend } from "./data/kalshi";
import "./App.css";

// GOLD, OIL don't trade on weekends (commodity markets, unlike the
// always-on crypto ones) — hidden here rather than removed so they're a
// one-line uncomment to bring back once they reopen.
const MARKETS = [
  { symbol: "BTC" },
  { symbol: "DOGE" },
  { symbol: "ETH" },
  { symbol: "NEAR" },
  { symbol: "HYPE" },
  { symbol: "SILVER" },
  // { symbol: "GOLD" },
  // { symbol: "OIL" },
];

function formatBalance(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPnl(dollars: number): string {
  const sign = dollars > 0 ? "+" : dollars < 0 ? "-" : "";
  return `${sign}$${Math.abs(dollars).toFixed(2)}`;
}

function pnlClass(dollars: number): string {
  if (dollars > 0) return "positive";
  if (dollars < 0) return "negative";
  return "";
}

function App() {
  const { balanceCents } = useWallet();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MARKETS.map((m) => [m.symbol, true]))
  );
  // Each card reports its own P&L up here — used to order the market list
  // (see sortedMarkets below), not to show an aggregate total.
  const [pnlBySymbol, setPnlBySymbol] = useState<Record<string, number>>({});

  // Paper-trading simulation total across every market — see
  // server/simTracker.ts. Shown alongside real P&L so it's a direct,
  // side-by-side read on whether current conditions look worth running the
  // bots for, not just a per-market curiosity.
  const [simPnlBySymbol, setSimPnlBySymbol] = useState<Record<string, number>>({});
  const totalSimPnl = Object.values(simPnlBySymbol).reduce((sum, v) => sum + v, 0);

  // Rolling last-hour slice of the same paper total, summed the same way —
  // see MarketCard's own bar-pnl-sim-hour for the per-market figure this aggregates.
  const [simLastHourBySymbol, setSimLastHourBySymbol] = useState<Record<string, number>>({});
  const totalSimLastHour = Object.values(simLastHourBySymbol).reduce((sum, v) => sum + v, 0);

  // Same idea as P&L: each card reports its own resting/holding state up
  // here so the list can be reordered around it — see sortedMarkets below.
  const [statusBySymbol, setStatusBySymbol] = useState<
    Record<string, { resting: boolean; holding: boolean }>
  >({});

  // Every 15m market rolls over on the same wall-clock boundary, so one
  // shared countdown (fed by whichever card last reported) is exactly as
  // accurate as showing it on each card separately. The actual 1s tick
  // lives inside <Countdown> so it doesn't re-render the rest of the app.
  const [closeTime, setCloseTime] = useState<number | null>(null);

  const handlePnlChange = useCallback((symbol: string, dollars: number) => {
    setPnlBySymbol((prev) => (prev[symbol] === dollars ? prev : { ...prev, [symbol]: dollars }));
  }, []);

  const handleSimPnlChange = useCallback((symbol: string, dollars: number, lastHourDollars: number) => {
    setSimPnlBySymbol((prev) => (prev[symbol] === dollars ? prev : { ...prev, [symbol]: dollars }));
    setSimLastHourBySymbol((prev) =>
      prev[symbol] === lastHourDollars ? prev : { ...prev, [symbol]: lastHourDollars }
    );
  }, []);

  // One stable reference shared by every card (instead of a fresh closure
  // per card per render) so MarketCard's memoization actually holds.
  const handleToggle = useCallback((symbol: string) => {
    setEnabled((prev) => ({ ...prev, [symbol]: !prev[symbol] }));
  }, []);

  const handleStatusChange = useCallback((symbol: string, resting: boolean, holding: boolean) => {
    setStatusBySymbol((prev) => {
      const current = prev[symbol];
      if (current && current.resting === resting && current.holding === holding) return prev;
      return { ...prev, [symbol]: { resting, holding } };
    });
  }, []);

  const handleCloseTimeChange = useCallback((time: number | null) => {
    setCloseTime((prev) => (prev === time ? prev : time));
  }, []);

  // Ordered by P&L, except a market you're actually holding a position in
  // floats to the very top regardless of P&L, and anything paused off
  // drops to the bottom — a resting (unfilled) order doesn't move the list
  // on its own, only a real fill does. Ties broken by each market's fixed
  // position in MARKETS so cards don't jitter against each other while
  // sitting at the same value.
  function priority(symbol: string): number {
    if (!enabled[symbol]) return 2;
    if (statusBySymbol[symbol]?.holding) return 0;
    return 1;
  }

  const sortedMarkets = [...MARKETS].sort((a, b) => {
    const priorityDiff = priority(a.symbol) - priority(b.symbol);
    if (priorityDiff !== 0) return priorityDiff;
    const diff = (pnlBySymbol[b.symbol] ?? 0) - (pnlBySymbol[a.symbol] ?? 0);
    if (diff !== 0) return diff;
    return MARKETS.indexOf(a) - MARKETS.indexOf(b);
  });

  return (
    <div className="app">
      <div className="app-header">
        <div className="header-spacer" aria-hidden="true" />
        <Countdown closeTime={closeTime} />
        <div className="header-right">
          <span
            className={`sim-pnl-value ${pnlClass(totalSimPnl)}`}
            title="Paper trade sim total across every market — $5 in at 6c, out at 95c, session-only"
          >
            <span className="sim-pnl-label">SIM</span>
            {formatPnl(totalSimPnl)}
          </span>
          <span
            className={`sim-pnl-value sim-pnl-hour ${pnlClass(totalSimLastHour)}`}
            title="Paper trade sim total across every market, last hour only"
          >
            <span className="sim-pnl-label">1HR</span>
            {formatPnl(totalSimLastHour)}
          </span>
          <button
            type="button"
            className="pnl-reset-btn"
            title="Clear today's real P&L and start fresh from now"
            aria-label="Clear today's P&L"
            onClick={() => sendToBackend({ cmd: "resetPnl" })}
          >
            ↺
          </button>
          <span className="wallet-balance">{formatBalance(balanceCents)}</span>
        </div>
      </div>
      <div className="market-grid">
        {sortedMarkets.map((m) => (
          <motion.div key={m.symbol} layout transition={{ type: "spring", stiffness: 380, damping: 32 }}>
            <MarketCard
              symbol={m.symbol}
              enabled={enabled[m.symbol]}
              onToggle={handleToggle}
              onPnlChange={handlePnlChange}
              onSimPnlChange={handleSimPnlChange}
              onCloseTimeChange={handleCloseTimeChange}
              onStatusChange={handleStatusChange}
            />
          </motion.div>
        ))}
      </div>
      <ActivityLog />
    </div>
  );
}

export default App;
