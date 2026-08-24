import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { HistoryPoint, MarketInfo } from "../types/market";
import { formatPnl, pnlClass } from "../lib/format";
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
};
const DEFAULT_COLOR = "#f4f6f8";

// Time left in that point's own 15m market, not wall-clock time-of-day —
// matches how the countdown at the top of the app reads, e.g. "1:07" for
// just over a minute left rather than a raw clock timestamp.
function formatCountdown(secondsLeft: number): string {
  const clamped = Math.max(0, Math.round(secondsLeft));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const WINDOW_OPTIONS = [5, 30] as const;
type WindowMinutes = (typeof WINDOW_OPTIONS)[number];

// Auto-zoom floor scales with the selected window instead of being one
// fixed number — a fixed floor (e.g. always 90s) meant that with under 5
// minutes of real data buffered, switching from 5m to 30m produced the
// exact same (data-limited) domain both times, so the button looked
// broken. Scaling the floor with the window keeps 30m visibly wider than
// 5m immediately, even before 30 real minutes have accumulated.
const MIN_WINDOW_FRACTION = 0.2;
const ABSOLUTE_MIN_WINDOW_SECONDS = 60;

// Map a 0-100 value (or a 0..spanSeconds time offset) into a slightly
// inset drawable range instead of the full 0-100, so a point sitting right
// at the true edge still has room for its stroke width and the price
// label — otherwise either gets clipped by the plot's rounded corners.
const MARGIN = 8;
const inset = (frac01: number) => MARGIN + frac01 * (100 - 2 * MARGIN);

// points is sorted by time ascending (history is appended in order) — binary
// search for the closest one to a hovered time instead of a linear scan,
// since a 30m window can hold thousands of points at the 200ms commit rate.
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
  // Live unrealized P&L on the currently open position, null when flat —
  // shown in the chart's own footer rather than the compact top bar.
  unrealizedDollars: number | null;
};

// Filled area chart of YES price, 0-100 fixed on the y-axis, colored to
// match this market's own line color on Kalshi. Defaults to a tight
// 5-minute live view with a button to swap to the full 30-minute lookback
// useMarket.ts keeps buffered — zooms to fit whatever data actually exists
// yet within the selected window (down to a floor) instead of always
// stretching the full window, so a freshly (re)loaded card isn't mostly
// empty space with all the real line crammed into a sliver.
export function MarketChart({ symbol, history, currentYes, market, unrealizedDollars }: MarketChartProps) {
  const [windowMinutes, setWindowMinutes] = useState<WindowMinutes>(5);
  const [hoverPoint, setHoverPoint] = useState<HistoryPoint | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const color = SYMBOL_COLOR[symbol] ?? DEFAULT_COLOR;

  // Anchor the domain's right edge to the latest *committed* data point,
  // not live Date.now() — history only advances once/second (see
  // useMarket.ts's commit timer), but this component can re-render more
  // often than that (sibling state changes, etc). Using Date.now() as the
  // right edge meant the same last point drifted slightly left on every
  // re-render between commits, then snapped right on the next real tick —
  // the "dot shifting left and right" jitter. Anchoring to the last real
  // point instead means the domain only moves when new data actually
  // arrives, and the dot always sits at exactly the same inset position.
  const effectiveNow = history.length > 0 ? history[history.length - 1].time : Date.now() / 1000;
  const fixedFrom = effectiveNow - windowMinutes * 60;
  const minWindowSeconds = Math.max(ABSOLUTE_MIN_WINDOW_SECONDS, windowMinutes * 60 * MIN_WINDOW_FRACTION);

  const points = history.filter((p) => p.time >= fixedFrom);

  const earliest = points.length > 0 ? points[0].time : effectiveNow - minWindowSeconds;
  const domainStart = Math.min(effectiveNow - minWindowSeconds, Math.max(fixedFrom, earliest));
  const domainSpan = Math.max(effectiveNow - domainStart, 1);

  const toX = (time: number) => inset((time - domainStart) / domainSpan);
  const toY = (yes: number) => inset(1 - Math.min(100, Math.max(0, yes)) / 100);

  // Break the line at each 15m rollover instead of connecting across it or
  // papering over the transition — the real fix for the old "dead 0 lull"
  // was server-side (see index.ts's scheduleRolloverCheck): the server
  // used to take up to 15s to even notice a window had closed, during
  // which the old, already-closed ticker's feed went stale/quiet and got
  // rendered as if it were live. With that lag actually fixed at the
  // source, whatever small real gap remains here (Kalshi briefly
  // finishing settlement, our resubscription completing) is genuinely
  // just missing data — better shown as a real gap than smoothed over
  // with a fabricated flat line or a fabricated diagonal one.
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
      .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.time).toFixed(2)} ${toY(p.yes).toFixed(2)}`)
      .join(" ");
    linePieces.push(segLine);
    const lastX = toX(seg[seg.length - 1].time).toFixed(2);
    const firstX = toX(seg[0].time).toFixed(2);
    areaPieces.push(`${segLine} L ${lastX} 100 L ${firstX} 100 Z`);
  }
  const lineD = linePieces.join(" ");
  const areaD = areaPieces.join(" ");

  // A vertical divider at every window rollover the chart's current view
  // spans — makes the boundary between two different contracts obvious at
  // a glance, on top of (not instead of) breaking the line itself.
  const boundaryXs = segments.slice(1).map((seg) => toX(seg[0].time));

  // Each segment is one 15m market's data — the countdown a hovered point
  // shows is time left in *that* market, not the currently active one. The
  // live segment's close time comes from `market` itself; an earlier
  // (already-rolled-over) segment's close is approximated by the next
  // segment's first tick, since the server pre-subscribes and switches
  // right at the boundary (see server/index.ts's scheduleSwitch) — no
  // meaningful gap between one window closing and the next opening.
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
  const dotX = lastPoint ? toX(lastPoint.time) : null;
  const dotY = lastPoint ? toY(lastPoint.yes) : null;

  function handleHoverMove(e: MouseEvent<HTMLDivElement>) {
    if (points.length === 0) return;
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
    const frac01 = (xPercent - MARGIN) / (100 - 2 * MARGIN);
    const time = domainStart + frac01 * domainSpan;
    setHoverPoint(nearestPoint(points, time));
  }

  const hoverX = hoverPoint ? toX(hoverPoint.time) : null;
  const hoverY = hoverPoint ? toY(hoverPoint.yes) : null;
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
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaD && <path d={areaD} fill={`url(#${gradientId})`} stroke="none" />}
          <line
            x1={0}
            x2={100}
            y1={toY(50)}
            y2={toY(50)}
            className="chart-mid-line"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            x2={100}
            y1={toY(0)}
            y2={toY(0)}
            className="chart-edge-line"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            x2={100}
            y1={toY(100)}
            y2={toY(100)}
            className="chart-edge-line"
            vectorEffect="non-scaling-stroke"
          />
          {boundaryXs.map((x, i) => (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={0}
              y2={100}
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
          {hoverX !== null && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={0}
              y2={100}
              className="chart-hover-line"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* Plain positioned HTML, not SVG shapes, for the dot and label —
            the SVG's non-uniform x/y scaling (preserveAspectRatio="none")
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
