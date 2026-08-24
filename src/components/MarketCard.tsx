import { memo, useEffect, useState } from "react";
import { useMarket } from "../hooks/useMarket";
import { MarketChart } from "./MarketChart";
import { playBuyInSound, playWinSound } from "../lib/sounds";
import { formatPnl, pnlClass } from "../lib/format";
import "./MarketCard.css";

function formatPrice(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}`;
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
  symbol: string; // "BTC"
  enabled: boolean;
  // Takes symbol (rather than each card wrapping it in its own closure) so
  // App can pass every card the exact same function reference — required
  // for the memo() below to actually skip re-renders instead of seeing a
  // "changed" prop every time.
  onToggle: (symbol: string) => void;
  // Reported up so the app-level total can sum across every market without
  // each one having to stay mounted at the App level.
  onPnlChange: (symbol: string, dollars: number) => void;
  // Every 15m market shares the same close time, so the countdown is shown
  // once at the App level instead of once per bar — this just feeds it up.
  onCloseTimeChange: (time: number | null) => void;
  // Reported up so the card list can be reordered around order state —
  // holding/resting markets float to the top, see App.tsx.
  onStatusChange: (symbol: string, resting: boolean, holding: boolean) => void;
};

// One market's live status: an identity row (icon, symbol, resting/holding
// badge, P&L, toggle) over a collapsible line chart — tap the bar to hide
// or show it, mirroring the entry/exit thresholds' dips and flips is the
// chart's whole job, but you don't always want every card taking up that
// much vertical space at once. Owns its own data subscription (useMarket)
// so toggling the market off actually pauses the connection and commit
// timer, not just hides content.
export const MarketCard = memo(function MarketCard({
  symbol,
  enabled,
  onToggle,
  onPnlChange,
  onCloseTimeChange,
  onStatusChange,
}: MarketCardProps) {
  const [winning, setWinning] = useState(false);
  // Collapsed by default on mobile widths so more markets fit on screen at
  // once without scrolling — tap a bar to expand its chart. Desktop keeps
  // the previous always-expanded default. 900px matches App.css's own
  // desktop-grid breakpoint. Read once at mount (not kept in sync with
  // resize) since this is only meant to pick the *initial* state.
  const [expanded, setExpanded] = useState(() => window.matchMedia("(min-width: 900px)").matches);
  const {
    currentYes,
    market,
    history,
    resting,
    holding,
    pnlDollars,
    positionFp,
    costDollars,
    winFlash,
    buyInFlash,
  } = useMarket(symbol, enabled);

  useEffect(() => {
    onPnlChange(symbol, pnlDollars);
  }, [symbol, pnlDollars, onPnlChange]);

  useEffect(() => {
    onStatusChange(symbol, resting, holding);
  }, [symbol, resting, holding, onStatusChange]);

  // Gold glow for a couple seconds every time this market's P&L jumps up
  // from a real settlement — re-triggers on each new winFlash timestamp
  // even if a previous flash is still fading.
  useEffect(() => {
    if (winFlash === null) return;
    setWinning(true);
    playWinSound();
    const t = setTimeout(() => setWinning(false), 2200);
    return () => clearTimeout(t);
  }, [winFlash]);

  // A real entry fill means this market now matters — expand it (e.g. from
  // the mobile collapsed-by-default state) so its chart is immediately
  // visible instead of requiring a manual tap to find out what happened.
  useEffect(() => {
    if (buyInFlash === null) return;
    playBuyInSound();
    setExpanded(true);
  }, [buyInFlash]);

  useEffect(() => {
    if (enabled) onCloseTimeChange(market?.closeTime ?? null);
  }, [enabled, market?.closeTime, onCloseTimeChange]);

  const currentNo = currentYes === null ? null : 100 - currentYes;

  // Mark-to-market against the live price: YES contracts are worth their
  // current ask, NO contracts worth theirs — sign of positionFp says which
  // side is actually held. costDollars is what was paid for it, so the
  // difference is the unrealized gain/loss on the still-open position (as
  // opposed to pnlDollars, which is today's already-*settled* total).
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
        <span className="market-symbol">{symbol}</span>
        {enabled && (
          <div className="bar-yesno">
            <span className="bar-yesno-stat yes">
              <span className="bar-yesno-label">YES</span>
              {formatPrice(currentYes)}
            </span>
            <span className="bar-yesno-stat no">
              <span className="bar-yesno-label">NO</span>
              {formatPrice(currentNo)}
            </span>
          </div>
        )}
        {!enabled && <span className="bar-paused">Paused</span>}
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
        />
      )}
    </div>
  );
});
