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

// GOLD is a PNG captured from Kalshi's market page directly; the rest come
// from the CDN as webp except XRP/NEAR/HYPE/SOL, sourced as PNGs from
// CoinCap's public icon CDN.
const ICON_EXT: Record<string, string> = {
  GOLD: "png",
  XRP: "png",
  NEAR: "png",
  HYPE: "png",
  SOL: "png",
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
  onStatusChange: (symbol: string, resting: boolean, holding: boolean) => void;
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
  onStatusChange,
}: MarketCardProps) {
  const [winning, setWinning] = useState(false);
  const [simWinning, setSimWinning] = useState(false);
  const [sim40Winning, setSim40Winning] = useState(false);
  // Below 900px (matches App.css's desktop-grid breakpoint), charts stay
  // hidden — collapsed bars only, so every market fits on one phone screen.
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

  useEffect(() => {
    if (winFlash === null) return;
    setWinning(true);
    playWinSound();
    const t = setTimeout(() => setWinning(false), 2200);
    return () => clearTimeout(t);
  }, [winFlash]);

  // Only flash on a win — losses happen far more often and would make the
  // badge flicker constantly.
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

  // A real fill expands the chart so it's immediately visible — desktop
  // only, mobile charts stay hidden regardless.
  useEffect(() => {
    if (buyInFlash === null) return;
    playBuyInSound();
    if (isDesktop) setExpanded(true);
  }, [buyInFlash, isDesktop]);

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
                title={`Paper trade sim: ${simWins}W / ${simLosses}L — $1 in at 6c, out at 95c`}
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
              title={`Paper trade sim: ${sim40Wins}W / ${sim40Losses}L — $1 in at 6c, out at 40c, last 30m`}
            >
              {formatPnl(sim40Dollars)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
});
