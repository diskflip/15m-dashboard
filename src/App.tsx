import { useCallback, useEffect, useState } from "react";
import { MarketCard } from "./components/MarketCard";
import { Countdown } from "./components/Countdown";
import { ActivityLog } from "./components/ActivityLog";
import { useWallet } from "./hooks/useWallet";
import { HoverSyncProvider } from "./hooks/useHoverSync";
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

  // Tracked separately from the toggle itself since fullscreen can also be
  // exited via Esc or the browser's own UI, not just this button.
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }, []);

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

  const handleCloseTimeChange = useCallback((symbol: string, time: number | null) => {
    setCloseTimeBySymbol((prev) => (prev[symbol] === time ? prev : { ...prev, [symbol]: time }));
  }, []);

  return (
    <div className="app">
      <div className="app-header">
        <div className="header-left">
          <button
            type="button"
            className="icon-btn"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={toggleFullscreen}
          >
            ⛶
          </button>
        </div>
        <Countdown closeTime={closeTime} />
        <div className="header-right">
          <span className={`pnl-value ${pnlClass(totalPnl)}`}>{formatPnl(totalPnl)}</span>
          <button
            type="button"
            className="icon-btn"
            title="Clear today's real and paper P&L and start fresh from now"
            aria-label="Clear today's real and paper P&L"
            onClick={() => {
              sendToBackend({ cmd: "resetPnl" });
              sendToBackend({ cmd: "resetSim" });
            }}
          >
            ↺
          </button>
          <span className="wallet-balance">{formatBalance(balanceCents)}</span>
        </div>
      </div>
      <HoverSyncProvider>
        <div className="market-grid">
          {MARKETS.map((m) => (
            <MarketCard
              key={m.symbol}
              symbol={m.symbol}
              enabled={enabled[m.symbol]}
              onToggle={handleToggle}
              onPnlChange={handlePnlChange}
              onCloseTimeChange={handleCloseTimeChange}
            />
          ))}
        </div>
      </HoverSyncProvider>
      <ActivityLog />
    </div>
  );
}

export default App;
