import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { MarketCard } from "./components/MarketCard";
import { Countdown } from "./components/Countdown";
import { ActivityLog } from "./components/ActivityLog";
import { useWallet } from "./hooks/useWallet";
import { sendToBackend } from "./data/kalshi";
import { MARKETS as ALL_MARKETS } from "../markets.config";
import "./App.css";

const MARKETS = ALL_MARKETS.filter((m) => m.enabled);

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
  const [pnlBySymbol, setPnlBySymbol] = useState<Record<string, number>>({});
  const totalPnl = Object.values(pnlBySymbol).reduce((sum, v) => sum + v, 0);

  const [statusBySymbol, setStatusBySymbol] = useState<
    Record<string, { resting: boolean; holding: boolean }>
  >({});

  // Soonest close time across all enabled markets, so a paused or
  // weekend-closed market can't override the countdown with a stale value.
  const [closeTimeBySymbol, setCloseTimeBySymbol] = useState<Record<string, number | null>>({});
  const closeTime = Object.values(closeTimeBySymbol).reduce<number | null>(
    (soonest, t) => (t === null ? soonest : soonest === null ? t : Math.min(soonest, t)),
    null
  );

  const handlePnlChange = useCallback((symbol: string, dollars: number) => {
    setPnlBySymbol((prev) => (prev[symbol] === dollars ? prev : { ...prev, [symbol]: dollars }));
  }, []);

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

  const handleCloseTimeChange = useCallback((symbol: string, time: number | null) => {
    setCloseTimeBySymbol((prev) => (prev[symbol] === time ? prev : { ...prev, [symbol]: time }));
  }, []);

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
          <span className={`pnl-value ${pnlClass(totalPnl)}`}>{formatPnl(totalPnl)}</span>
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
