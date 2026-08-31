import { memo, useEffect, useState } from "react";
import { useMarket } from "../hooks/useMarket";
import { MarketChart } from "./MarketChart";
import { formatPnl, pnlClass } from "../lib/format";
import "./MarketCard.css";

function formatPrice(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}`;
}

function formatSpotPrice(dollars: number | null): string {
  return dollars === null ? "—" : `$${Math.round(dollars).toLocaleString("en-US")}`;
}

// GOLD and SILVER's Kalshi CDN icon path didn't match what's actually
// rendered on their market page (returned a generic ETF-ticker card
// instead) — those two were captured directly from the page as PNGs; the
// rest came straight from the CDN as webp. XRP/NEAR/HYPE came from
// CoinCap's public icon CDN (assets.coincap.io) instead, since Kalshi
// doesn't expose an icon URL through its REST API — also PNGs.
const ICON_EXT: Record<string, string> = {
  GOLD: "png",
  SILVER: "png",
  XRP: "png",
  NEAR: "png",
  HYPE: "png",
};
function iconSrc(symbol: string): string {
  return `/icons/${symbol}.${ICON_EXT[symbol] ?? "webp"}`;
}

type MarketCardProps = {
  symbol: string;
  enabled: boolean;
  // Takes symbol so App can pass every card the same function reference,
  // which memo() below needs to actually skip re-renders.
  onToggle: (symbol: string) => void;
  onPnlChange: (symbol: string, dollars: number) => void;
  onCloseTimeChange: (symbol: string, time: number | null) => void;
};

// One market's live status: an identity row over a collapsible chart. Owns
// its own data subscription (useMarket) so toggling it off actually pauses
// the connection, not just hides content.
export const MarketCard = memo(function MarketCard({
  symbol,
  enabled,
  onToggle,
  onPnlChange,
  onCloseTimeChange,
}: MarketCardProps) {
  const [winning, setWinning] = useState(false);
  const [sim1hWinning, setSim1hWinning] = useState(false);
  const [sim30mWinning, setSim30mWinning] = useState(false);
  // Below 900px (matches App.css's desktop-grid breakpoint), cards start
  // collapsed to bars-only instead of expanded — still tappable open to a
  // compact horizontal chart, just not shown by default so every market
  // fits on one phone screen at a glance.
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 900px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [expanded, setExpanded] = useState(isDesktop);
  const {
    currentYes,
    market,
    history,
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
  } = useMarket(symbol, enabled);

  useEffect(() => {
    onPnlChange(symbol, pnlDollars);
  }, [symbol, pnlDollars, onPnlChange]);

  useEffect(() => {
    if (winFlash === null) return;
    setWinning(true);
    const t = setTimeout(() => setWinning(false), 2200);
    return () => clearTimeout(t);
  }, [winFlash]);

  // Only flash on a win — losses happen far more often and would make the
  // badge flicker constantly.
  useEffect(() => {
    if (sim1hFlash === null || sim1hFlash.result !== "win") return;
    setSim1hWinning(true);
    const t = setTimeout(() => setSim1hWinning(false), 1400);
    return () => clearTimeout(t);
  }, [sim1hFlash]);

  useEffect(() => {
    if (sim30mFlash === null || sim30mFlash.result !== "win") return;
    setSim30mWinning(true);
    const t = setTimeout(() => setSim30mWinning(false), 1400);
    return () => clearTimeout(t);
  }, [sim30mFlash]);

  // A real fill expands the chart so it's immediately visible, on mobile
  // too now that its chart has its own compact horizontal layout.
  useEffect(() => {
    if (buyInFlash === null) return;
    setExpanded(true);
  }, [buyInFlash]);

  useEffect(() => {
    onCloseTimeChange(symbol, enabled ? market?.closeTime ?? null : null);
  }, [symbol, enabled, market?.closeTime, onCloseTimeChange]);

  const currentNo = currentYes === null ? null : 100 - currentYes;

  // Mark-to-market against the live price: sign of positionFp says which
  // side is held; costDollars is what was paid for it.
  const unrealizedDollars =
    positionFp !== 0 && currentYes !== null && currentNo !== null
      ? (positionFp > 0 ? positionFp * (currentYes / 100) : -positionFp * (currentNo / 100)) -
        costDollars
      : null;

  return (
    <div
      className={`market-bar ${enabled ? "" : "disabled"} ${
        enabled && holding ? "state-holding" : enabled && resting ? "state-resting" : ""
      } ${enabled && winning ? "win-flash" : ""}`}
      onClick={() => {
        if (enabled) setExpanded((e) => !e);
      }}
    >
      <div className="bar-row">
        <img className="market-icon" src={iconSrc(symbol)} alt="" width={28} height={28} />
        <div className="bar-identity">
          <span className="market-symbol">{symbol}</span>
          {enabled && (
            <div className="bar-yesno">
              <span className="bar-yesno-price yes">{formatPrice(currentYes)}</span>
              <span className="bar-yesno-slash">/</span>
              <span className="bar-yesno-price no">{formatPrice(currentNo)}</span>
            </div>
          )}
          {!enabled && <span className="bar-paused">Paused</span>}
        </div>
        <div className="bar-row-right">
          {enabled && (resting || holding) && (
            <div className="order-badges">
              {holding ? (
                <span className="order-badge holding">HOLDING</span>
              ) : (
                <span className="order-badge resting">RESTING</span>
              )}
            </div>
          )}
          {enabled && (
            <span className={`bar-pnl ${pnlClass(pnlDollars)}`}>{formatPnl(pnlDollars)}</span>
          )}
          <button
            type="button"
            className={`toggle-switch ${enabled ? "on" : ""}`}
            role="switch"
            aria-checked={enabled}
            aria-label={`${enabled ? "Pause" : "Resume"} ${symbol}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(symbol);
            }}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      {enabled && expanded && (
        <MarketChart
          symbol={symbol}
          history={history}
          currentYes={currentYes}
          market={market}
          unrealizedDollars={holding ? unrealizedDollars : null}
          orientation={isDesktop ? "vertical" : "horizontal"}
        />
      )}

      {enabled && (
        <div className="bar-footer">
          <span className="bar-footer-spot">
            {symbol === "BTC" ? formatSpotPrice(spotPriceDollars) : ""}
          </span>
          {/* Same 6c-in/50c-out paper strategy, two rolling windows. */}
          <span className="bar-pnl-sim-row">
            <span className="bar-pnl-sim-item">
              <span className="bar-pnl-sim-label">1hr</span>
              <span
                className={`bar-pnl-sim-value ${pnlClass(sim1hDollars)} ${sim1hWinning ? "flash" : ""}`}
                title={`Paper trade sim: ${sim1hWins}W / ${sim1hLosses}L — $1 in at 6c, out at 50c, last 1hr`}
              >
                {formatPnl(sim1hDollars)}
              </span>
            </span>
            <span className="bar-pnl-sim-item">
              <span className="bar-pnl-sim-label">30m</span>
              <span
                className={`bar-pnl-sim-value ${pnlClass(sim30mDollars)} ${sim30mWinning ? "flash" : ""}`}
                title={`Paper trade sim: ${sim30mWins}W / ${sim30mLosses}L — $1 in at 6c, out at 50c, last 30m`}
              >
                {formatPnl(sim30mDollars)}
              </span>
            </span>
          </span>
        </div>
      )}
    </div>
  );
});
