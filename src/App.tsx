import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { MarketCard } from "./components/MarketCard";
import { Countdown } from "./components/Countdown";
import { ActivityLog } from "./components/ActivityLog";
import { useWallet } from "./hooks/useWallet";
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
  // Each card reports its own P&L up here so the total can sum across
  // every market without all of them having to live at the App level —
  // a paused (toggled-off) market reports 0 and drops out of the total.
  const [pnlBySymbol, setPnlBySymbol] = useState<Record<string, number>>({});
  const totalPnl = Object.values(pnlBySymbol).reduce((sum, v) => sum + v, 0);

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
        <Countdown closeTime={closeTime} />
        <span className={`pnl-value ${pnlClass(totalPnl)}`}>{formatPnl(totalPnl)}</span>
        <span className="wallet-balance">{formatBalance(balanceCents)}</span>
      </div>
      <div className="market-grid">
        {sortedMarkets.map((m) => (
          <motion.div key={m.symbol} layout transition={{ type: "spring", stiffness: 380, damping: 32 }}>
            <MarketCard
              symbol={m.symbol}
              enabled={enabled[m.symbol]}
              onToggle={handleToggle}
              onPnlChange={handlePnlChange}
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
