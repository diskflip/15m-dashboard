import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { HistoryPoint, MarketInfo } from "../types/market";
import { formatPnl, pnlClass } from "../lib/format";
import "./MarketChart.css";

// Matches each symbol's chart line color on Kalshi's own market pages.
const SYMBOL_COLOR: Record<string, string> = {
  BTC: "#f0a030",
  ETH: "#6c79d6",
  DOGE: "#d4b84a",
  SOL: "#9945ff",
  GOLD: "#e3a83d",
  OIL: "#d68a3e",
  NEAR: "#01eb9a",
  HYPE: "#00e5c4",
};
const DEFAULT_COLOR = "#f4f6f8";

function formatCountdown(secondsLeft: number): string {
  const clamped = Math.max(0, Math.round(secondsLeft));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const WINDOW_OPTIONS = [5, 30] as const;
type WindowMinutes = (typeof WINDOW_OPTIONS)[number];

// Scales with the selected window so a data-limited domain doesn't look
// identical across window sizes before enough real data has accumulated.
const MIN_WINDOW_FRACTION = 0.2;
const ABSOLUTE_MIN_WINDOW_SECONDS = 60;

// Insets the drawable range so a point at the true edge isn't clipped by
// the plot's rounded corners.
const MARGIN = 3;
const inset = (frac01: number) => MARGIN + frac01 * (100 - 2 * MARGIN);

const MARGIN_TIME_TOP = 3;
const MARGIN_TIME_BOTTOM = 7;
const insetTime = (frac01: number) =>
  MARGIN_TIME_TOP + frac01 * (100 - MARGIN_TIME_TOP - MARGIN_TIME_BOTTOM);

// Binary search since a 30m window can hold thousands of points.
function nearestPoint(points: HistoryPoint[], time: number): HistoryPoint {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].time - time) <= Math.abs(points[lo].time - time)) {
    return points[lo - 1];
  }
  return points[lo];
}

type MarketChartProps = {
  symbol: string;
  history: HistoryPoint[];
  currentYes: number | null;
  market: MarketInfo | null;
  unrealizedDollars: number | null;
};

// Filled area chart of YES price, 0-100 fixed, with a toggle between a
// tight 5-minute view and the full 30-minute lookback useMarket.ts buffers.
export function MarketChart({ symbol, history, currentYes, market, unrealizedDollars }: MarketChartProps) {
  const [windowMinutes, setWindowMinutes] = useState<WindowMinutes>(5);
  const [hoverPoint, setHoverPoint] = useState<HistoryPoint | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const color = SYMBOL_COLOR[symbol] ?? DEFAULT_COLOR;

  // Anchored to the last committed point, not Date.now() — otherwise the
  // dot jitters left/right between commits on every re-render.
  const effectiveNow = history.length > 0 ? history[history.length - 1].time : Date.now() / 1000;
  const fixedFrom = effectiveNow - windowMinutes * 60;
  const minWindowSeconds = Math.max(ABSOLUTE_MIN_WINDOW_SECONDS, windowMinutes * 60 * MIN_WINDOW_FRACTION);

  const points = history.filter((p) => p.time >= fixedFrom);

  const earliest = points.length > 0 ? points[0].time : effectiveNow - minWindowSeconds;
  const domainStart = Math.min(effectiveNow - minWindowSeconds, Math.max(fixedFrom, earliest));
  const domainSpan = Math.max(effectiveNow - domainStart, 1);

  // Rotated 90°: price runs horizontally (YES at 100 on the left, NO at 100
  // on the right), time runs vertically, oldest at the top.
  const toX = (yes: number) => inset(1 - Math.min(100, Math.max(0, yes)) / 100);
  const toY = (time: number) => insetTime((time - domainStart) / domainSpan);

  // Break the line at each 15m rollover instead of connecting across it —
  // a real gap between windows, not a fabricated line.
  const segments: HistoryPoint[][] = [];
  for (const p of points) {
    const current = segments[segments.length - 1];
    if (current && current[current.length - 1].ticker === p.ticker) {
      current.push(p);
    } else {
      segments.push([p]);
    }
  }

  const linePieces: string[] = [];
  const areaPieces: string[] = [];
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const segLine = seg
      .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.yes).toFixed(2)} ${toY(p.time).toFixed(2)}`)
      .join(" ");
    linePieces.push(segLine);
    // Fills toward the NO=100 reference line, not the raw chart edge.
    const baseline = toX(0).toFixed(2);
    const lastY = toY(seg[seg.length - 1].time).toFixed(2);
    const firstY = toY(seg[0].time).toFixed(2);
    areaPieces.push(`${segLine} L ${baseline} ${lastY} L ${baseline} ${firstY} Z`);
  }
  const lineD = linePieces.join(" ");
  const areaD = areaPieces.join(" ");

  const boundaryYs = segments.slice(1).map((seg) => toY(seg[0].time));

  // The hovered point's countdown is time left in *its* market, not the
  // current one. A rolled-over segment's close is approximated by the next
  // segment's first tick.
  const closeTimeByTicker = new Map<string, number>();
  segments.forEach((seg, i) => {
    const ticker = seg[0]?.ticker;
    if (!ticker) return;
    if (i < segments.length - 1) {
      closeTimeByTicker.set(ticker, segments[i + 1][0].time);
    } else if (market && ticker === market.ticker) {
      closeTimeByTicker.set(ticker, market.closeTime);
    }
  });

  const gradientId = `chart-fill-${symbol}`;
  const lastPoint = points.length > 0 ? points[points.length - 1] : null;
  const dotX = lastPoint ? toX(lastPoint.yes) : null;
  const dotY = lastPoint ? toY(lastPoint.time) : null;

  function handleHoverMove(e: MouseEvent<HTMLDivElement>) {
    if (points.length === 0) return;
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
    const frac01 = (yPercent - MARGIN_TIME_TOP) / (100 - MARGIN_TIME_TOP - MARGIN_TIME_BOTTOM);
    const time = domainStart + frac01 * domainSpan;
    setHoverPoint(nearestPoint(points, time));
  }

  const hoverX = hoverPoint ? toX(hoverPoint.yes) : null;
  const hoverY = hoverPoint ? toY(hoverPoint.time) : null;
  const hoverColor = hoverPoint && hoverPoint.ticker !== lastPoint?.ticker ? DEFAULT_COLOR : color;
  const hoverCloseTime = hoverPoint?.ticker ? closeTimeByTicker.get(hoverPoint.ticker) : undefined;
  const hoverCountdown =
    hoverPoint && hoverCloseTime !== undefined ? formatCountdown(hoverCloseTime - hoverPoint.time) : null;

  return (
    <div className="chart">
      <div
        className="chart-plot"
        ref={plotRef}
        onMouseMove={handleHoverMove}
        onMouseLeave={() => setHoverPoint(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="chart-svg">
          <defs>
            {/* Opaque at the YES edge, fading to transparent at the NO baseline. */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaD && <path d={areaD} fill={`url(#${gradientId})`} stroke="none" />}
          <line
            x1={toX(50)}
            x2={toX(50)}
            y1={0}
            y2={100}
            className="chart-mid-line"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={toX(0)}
            x2={toX(0)}
            y1={0}
            y2={100}
            className="chart-edge-line"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={toX(100)}
            x2={toX(100)}
            y1={0}
            y2={100}
            className="chart-edge-line"
            vectorEffect="non-scaling-stroke"
          />
          {boundaryYs.map((y, i) => (
            <line
              key={i}
              x1={0}
              x2={100}
              y1={y}
              y2={y}
              className="chart-boundary-line"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {lineD && (
            <path
              d={lineD}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {hoverY !== null && (
            <line
              x1={0}
              x2={100}
              y1={hoverY}
              y2={hoverY}
              className="chart-hover-line"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* HTML, not SVG, for the dot/label — preserveAspectRatio="none"
            would squash a true circle into an ellipse. */}
        {dotX !== null && dotY !== null && (
          <span
            className="chart-dot"
            style={{ left: `${dotX}%`, top: `${dotY}%`, background: color }}
          />
        )}
        {currentYes !== null && dotX !== null && dotY !== null && (
          <span
            className="chart-current-label"
            style={{ left: `${dotX}%`, top: `${dotY}%`, color }}
          >
            {Math.round(currentYes)}
          </span>
        )}
        {hoverPoint && hoverX !== null && hoverY !== null && (
          <>
            <span
              className="chart-hover-dot"
              style={{ left: `${hoverX}%`, top: `${hoverY}%`, background: hoverColor }}
            />
            <div
              className={`chart-hover-tooltip ${hoverX > 50 ? "align-right" : "align-left"}`}
              style={{ left: `${hoverX}%`, top: `${hoverY}%` }}
            >
              {hoverCountdown !== null && (
                <span className="chart-hover-time">{hoverCountdown}</span>
              )}
              <span className="chart-hover-yes">YES {Math.round(hoverPoint.yes)}</span>
              <span className="chart-hover-no">NO {Math.round(100 - hoverPoint.yes)}</span>
            </div>
          </>
        )}
      </div>
      <div className="chart-axis">
        {unrealizedDollars !== null && (
          <span className={`chart-unrealized ${pnlClass(unrealizedDollars)}`}>
            {formatPnl(unrealizedDollars)}
          </span>
        )}
        <div className="chart-window-toggle">
          {WINDOW_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              className={`chart-window-btn ${m === windowMinutes ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setWindowMinutes(m);
              }}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
