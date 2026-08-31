import { useRef, useState } from "react";
import type { MouseEvent, TouchEvent } from "react";
import type { HistoryPoint, MarketInfo } from "../types/market";
import { formatPnl, pnlClass } from "../lib/format";
import { useHoverSync } from "../hooks/useHoverSync";
import "./MarketChart.css";

// Sampled directly off Kalshi's own 15-minute market pages (each symbol's
// live price chart is drawn in its own color there) — not the icon tile
// colors, the actual chart line colors.
const SYMBOL_COLOR: Record<string, string> = {
  BTC: "#f0a030",
  ETH: "#6c79d6",
  DOGE: "#d4b84a",
  SILVER: "#ffffff",
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

// Horizontal (mobile) gets a tighter close-up window than vertical
// (desktop) — the same 5m's worth of ticks reads as busier squeezed into
// a short, wide mobile chart than a tall, narrow desktop one.
const WINDOW_OPTIONS_VERTICAL = [5, 30] as const;
const WINDOW_OPTIONS_HORIZONTAL = [3, 30] as const;
type WindowMinutes = 3 | 5 | 30;

// Scales with the selected window so a data-limited domain doesn't look
// identical across window sizes before enough real data has accumulated.
const MIN_WINDOW_FRACTION = 0.2;
const ABSOLUTE_MIN_WINDOW_SECONDS = 60;

// Symmetric inset for whichever axis carries price — no edge there needs
// extra clearance, since the live price label floats at the dot rather
// than pinning to a fixed edge.
const MARGIN = 3;
const inset = (frac01: number) => MARGIN + frac01 * (100 - 2 * MARGIN);

// Asymmetric inset for whichever axis carries time — the newest-time edge
// carries the live dot + price label and needs more clearance than the
// oldest-time edge. Horizontal orientation's label sits beside the dot
// (not below it), which needs more reserved room than vertical's does, so
// its edge can't ever bleed past the plot's right side.
const MARGIN_TIME_START = 3;
const MARGIN_TIME_END_VERTICAL = 7;
const MARGIN_TIME_END_HORIZONTAL = 14;

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

type Orientation = "vertical" | "horizontal";

type MarketChartProps = {
  symbol: string;
  history: HistoryPoint[];
  currentYes: number | null;
  market: MarketInfo | null;
  unrealizedDollars: number | null;
  // "vertical" (default) rotates the chart 90° — price runs horizontally,
  // time runs top-to-bottom. Used on desktop, where cards are tall.
  // "horizontal" is a traditional price-over-time chart — time runs
  // left-to-right, price runs top-to-bottom. Used on mobile, where cards
  // are full-width but short, so a wide-and-short chart fits better than
  // a tall-and-narrow one.
  orientation?: Orientation;
};

// Filled area chart of YES price, 0-100 fixed, with a toggle between a
// tight close-up view (5m vertical, 3m horizontal) and the full 30-minute
// lookback useMarket.ts buffers.
export function MarketChart({
  symbol,
  history,
  currentYes,
  market,
  unrealizedDollars,
  orientation = "vertical",
}: MarketChartProps) {
  const isVertical = orientation === "vertical";
  const windowOptions = isVertical ? WINDOW_OPTIONS_VERTICAL : WINDOW_OPTIONS_HORIZONTAL;
  const [windowMinutes, setWindowMinutes] = useState<WindowMinutes>(isVertical ? 5 : 3);
  const [hoverPoint, setHoverPoint] = useState<HistoryPoint | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const color = SYMBOL_COLOR[symbol] ?? DEFAULT_COLOR;
  const { hoverTime, setHoverTime, shiftHeld } = useHoverSync();
  const marginTimeEnd = isVertical ? MARGIN_TIME_END_VERTICAL : MARGIN_TIME_END_HORIZONTAL;
  const insetTime = (frac01: number) =>
    MARGIN_TIME_START + frac01 * (100 - MARGIN_TIME_START - marginTimeEnd);

  // Anchored to the last committed point, not Date.now() — otherwise the
  // dot jitters left/right between commits on every re-render.
  const effectiveNow = history.length > 0 ? history[history.length - 1].time : Date.now() / 1000;
  const fixedFrom = effectiveNow - windowMinutes * 60;
  const minWindowSeconds = Math.max(ABSOLUTE_MIN_WINDOW_SECONDS, windowMinutes * 60 * MIN_WINDOW_FRACTION);

  const points = history.filter((p) => p.time >= fixedFrom);

  const earliest = points.length > 0 ? points[0].time : effectiveNow - minWindowSeconds;
  const domainStart = Math.min(effectiveNow - minWindowSeconds, Math.max(fixedFrom, earliest));
  const domainSpan = Math.max(effectiveNow - domainStart, 1);

  // Price position along whichever axis carries price: YES=100 at the
  // start of that axis, YES=0/NO=100 at the end.
  const toPricePos = (yes: number) => inset(1 - Math.min(100, Math.max(0, yes)) / 100);
  // Time position along whichever axis carries time: oldest at the start,
  // newest (with extra clearance) at the end.
  const toTimePos = (time: number) => insetTime((time - domainStart) / domainSpan);

  // Vertical: price on X (YES at 100 on the left, NO at 100 on the right),
  // time on Y (oldest at top, newest at bottom). Horizontal: time on X
  // (oldest on the left, newest on the right), price on Y (YES at 100 on
  // top, NO at 100 on the bottom) — a traditional price-over-time chart.
  const project = (yes: number, time: number) => {
    const p = toPricePos(yes);
    const t = toTimePos(time);
    return isVertical ? { x: p, y: t } : { x: t, y: p };
  };
  // A reference line at a fixed price, spanning the full time axis.
  const priceLine = (yes: number) => {
    const p = toPricePos(yes);
    return isVertical ? { x1: p, x2: p, y1: 0, y2: 100 } : { x1: 0, x2: 100, y1: p, y2: p };
  };
  // A reference line at a fixed time, spanning the full price axis.
  const timeLine = (time: number) => {
    const t = toTimePos(time);
    return isVertical ? { x1: 0, x2: 100, y1: t, y2: t } : { x1: t, x2: t, y1: 0, y2: 100 };
  };

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
      .map((p, i) => {
        const { x, y } = project(p.yes, p.time);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
    linePieces.push(segLine);
    // Fills toward the NO=100 reference line, not the raw chart edge.
    const last = project(0, seg[seg.length - 1].time);
    const first = project(0, seg[0].time);
    areaPieces.push(
      `${segLine} L ${last.x.toFixed(2)} ${last.y.toFixed(2)} L ${first.x.toFixed(2)} ${first.y.toFixed(2)} Z`
    );
  }
  const lineD = linePieces.join(" ");
  const areaD = areaPieces.join(" ");

  const boundaryLines = segments.slice(1).map((seg) => timeLine(seg[0].time));

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
  const dot = lastPoint ? project(lastPoint.yes, lastPoint.time) : null;

  // Shared by mouse and touch — a press-and-drag finger on mobile reads a
  // point the same way a cursor hovering over the chart does on desktop.
  function updateHoverFromClientPos(clientX: number, clientY: number) {
    if (points.length === 0) return;
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Read the pointer position along whichever screen axis carries time.
    const dimSize = isVertical ? rect.height : rect.width;
    if (dimSize === 0) return;
    const posPx = isVertical ? clientY - rect.top : clientX - rect.left;
    const percent = (posPx / dimSize) * 100;
    const frac01 = (percent - MARGIN_TIME_START) / (100 - MARGIN_TIME_START - marginTimeEnd);
    const time = domainStart + frac01 * domainSpan;
    setHoverPoint(nearestPoint(points, time));
    // Publishes this chart's hovered time to every other chart while Shift
    // is held, so they can all drop a marker at the same instant.
    if (shiftHeld) setHoverTime(time);
  }

  function handleHoverMove(e: MouseEvent<HTMLDivElement>) {
    updateHoverFromClientPos(e.clientX, e.clientY);
  }

  function handleTouchMove(e: TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0];
    if (!touch) return;
    // Otherwise the page scrolls out from under the finger instead of
    // dragging the hover point across the chart.
    e.preventDefault();
    updateHoverFromClientPos(touch.clientX, touch.clientY);
  }

  function handleHoverLeave() {
    setHoverPoint(null);
    setHoverTime(null);
  }

  // Not the chart under the mouse, but Shift-hovering elsewhere published a
  // time within this chart's own visible range — find the matching point
  // in this chart's own data so every chart compares the same instant.
  const hoverTimeInRange =
    hoverTime !== null && hoverTime >= domainStart && hoverTime <= effectiveNow;
  const syncedHoverPoint =
    !hoverPoint && shiftHeld && hoverTimeInRange && points.length > 0
      ? nearestPoint(points, hoverTime!)
      : null;
  const effectiveHoverPoint = hoverPoint ?? syncedHoverPoint;

  const hoverPos = effectiveHoverPoint ? project(effectiveHoverPoint.yes, effectiveHoverPoint.time) : null;
  const hoverX = hoverPos?.x ?? null;
  const hoverY = hoverPos?.y ?? null;
  const hoverLine = effectiveHoverPoint ? timeLine(effectiveHoverPoint.time) : null;
  const hoverColor =
    effectiveHoverPoint && effectiveHoverPoint.ticker !== lastPoint?.ticker ? DEFAULT_COLOR : color;
  const hoverCloseTime = effectiveHoverPoint?.ticker
    ? closeTimeByTicker.get(effectiveHoverPoint.ticker)
    : undefined;
  const hoverCountdown =
    effectiveHoverPoint && hoverCloseTime !== undefined
      ? formatCountdown(hoverCloseTime - effectiveHoverPoint.time)
      : null;
  // The tooltip normally renders above the point; too close to the top
  // edge and chart-plot's overflow:hidden clips it — the timestamp is the
  // first line in the stack, so it's the one that silently disappears
  // while YES/NO (below it) stay visible. Flip it below instead.
  const TOOLTIP_FLIP_THRESHOLD = 20;
  const tooltipBelow = hoverY !== null && hoverY < TOOLTIP_FLIP_THRESHOLD;

  const midLine = priceLine(50);
  const yesEdgeLine = priceLine(100);
  const noEdgeLine = priceLine(0);

  return (
    <div className={`chart chart--${orientation}`}>
      <div
        className="chart-plot"
        ref={plotRef}
        onMouseMove={handleHoverMove}
        onMouseLeave={handleHoverLeave}
        onTouchStart={handleTouchMove}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleHoverLeave}
        onTouchCancel={handleHoverLeave}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="chart-svg">
          <defs>
            {/* Opaque at the YES edge, fading to transparent at the NO baseline. */}
            <linearGradient
              id={gradientId}
              x1="0"
              y1="0"
              x2={isVertical ? "1" : "0"}
              y2={isVertical ? "0" : "1"}
            >
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaD && <path d={areaD} fill={`url(#${gradientId})`} stroke="none" />}
          <line {...midLine} className="chart-mid-line" vectorEffect="non-scaling-stroke" />
          <line {...yesEdgeLine} className="chart-edge-line" vectorEffect="non-scaling-stroke" />
          <line {...noEdgeLine} className="chart-edge-line" vectorEffect="non-scaling-stroke" />
          {boundaryLines.map((l, i) => (
            <line key={i} {...l} className="chart-boundary-line" vectorEffect="non-scaling-stroke" />
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
          {hoverLine && (
            <line {...hoverLine} className="chart-hover-line" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {/* HTML, not SVG, for the dot/label — preserveAspectRatio="none"
            would squash a true circle into an ellipse. */}
        {dot && (
          <span
            className="chart-dot"
            style={{ left: `${dot.x}%`, top: `${dot.y}%`, background: color }}
          />
        )}
        {currentYes !== null && dot && (
          <span
            className="chart-current-label"
            style={{ left: `${dot.x}%`, top: `${dot.y}%`, color }}
          >
            {Math.round(currentYes)}
          </span>
        )}
        {effectiveHoverPoint && hoverX !== null && hoverY !== null && (
          <>
            <span
              className="chart-hover-dot"
              style={{ left: `${hoverX}%`, top: `${hoverY}%`, background: hoverColor }}
            />
            <div
              className={`chart-hover-tooltip ${hoverX > 50 ? "align-right" : "align-left"} ${
                tooltipBelow ? "align-below" : "align-above"
              }`}
              style={{ left: `${hoverX}%`, top: `${hoverY}%` }}
            >
              {hoverCountdown !== null && (
                <span className="chart-hover-time">{hoverCountdown}</span>
              )}
              <span className="chart-hover-yes">YES {Math.round(effectiveHoverPoint.yes)}</span>
              <span className="chart-hover-no">NO {Math.round(100 - effectiveHoverPoint.yes)}</span>
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
          {windowOptions.map((m) => (
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
