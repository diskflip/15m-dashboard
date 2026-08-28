import { memo, useEffect, useState } from "react";
import { useMarket } from "../hooks/useMarket";
import { MarketChart } from "./MarketChart";
import { playBuyInSound, playWinSound } from "../lib/sounds";
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
  const [simWinning, setSimWinning] = useState(false);
  const [sim40Winning, setSim40Winning] = useState(false);
  // Below 900px (matches App.css's desktop-grid breakpoint), charts are
  // hidden entirely — collapsed bars only, so every market fits on a phone
  // screen at once without scrolling. Kept in sync with resize/rotation
  // (not just read once at mount) so a phone rotated to landscape past the
  // breakpoint behaves like desktop.
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

  // Brief highlight on the paper stat only when a simulated trade *wins* —
  // losses happen far more often than wins for this strategy (see
  // FINDINGS.md) and would make the badge flicker constantly if it reacted
  // to those too, so it stays quiet except for the outcome worth noticing.
  useEffect(() => {
    if (simFlash === null || simFlash.result !== "win") return;
    setSimWinning(true);
    const t = setTimeout(() => setSimWinning(false), 1400);
    return () => clearTimeout(t);
  }, [simFlash]);

  useEffect(() => {
    if (sim40Flash === null || sim40Flash.result !== "win") return;
    setSim40Winning(true);
    const t = setTimeout(() => setSim40Winning(false), 1400);
    return () => clearTimeout(t);
  }, [sim40Flash]);

  // A real entry fill means this market now matters — expand it so its
  // chart is immediately visible instead of requiring a manual tap to find
  // out what happened. Desktop only: on mobile, charts stay hidden no
  // matter what so every card fits on screen at once.
  useEffect(() => {
    if (buyInFlash === null) return;
    playBuyInSound();
    if (isDesktop) setExpanded(true);
  }, [buyInFlash, isDesktop]);

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
        if (enabled && isDesktop) setExpanded((e) => !e);
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

      {enabled && expanded && isDesktop && (
        <MarketChart
          symbol={symbol}
          history={history}
          currentYes={currentYes}
          market={market}
          unrealizedDollars={holding ? unrealizedDollars : null}
        />
      )}

      {enabled && (
        <div className="bar-footer">
          <span className="bar-footer-spot">
            {symbol === "BTC" ? formatSpotPrice(spotPriceDollars) : ""}
          </span>
          <span className="bar-pnl-sim-row">
            <span className="bar-pnl-sim-group">
              <span
                className={`bar-pnl-sim ${pnlClass(simDollars)} ${simWinning ? "flash" : ""}`}
                title={`Paper trade sim: ${simWins}W / ${simLosses}L — $5 in at 6c, out at 95c`}
              >
                {formatPnl(simDollars)}
              </span>
              <span
                className={`bar-pnl-sim-hour ${pnlClass(simLastHourDollars)}`}
                title="Paper trade sim, last hour only"
              >
                {formatPnl(simLastHourDollars)}
              </span>
            </span>
            <span
              className={`bar-pnl-sim40 ${pnlClass(sim40Dollars)} ${sim40Winning ? "flash" : ""}`}
              title={`Paper trade sim: ${sim40Wins}W / ${sim40Losses}L — $5 in at 6c, out at 40c, last 30m`}
            >
              {formatPnl(sim40Dollars)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
});
