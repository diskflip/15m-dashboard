import { useCountdown } from "../hooks/useCountdown";

const GRADIENT_SECONDS = 5 * 60;
// Softer white and a muted red (matches the chart's own NO-side red)
// instead of a jarring white/neon-red snap — fades continuously across
// the last 5 minutes rather than jumping through discrete warn/critical
// steps.
const BASE_COLOR = { r: 255, g: 255, b: 255, a: 0.85 };
const URGENT_COLOR = { r: 224, g: 90, b: 90, a: 1 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function countdownColor(remainingSeconds: number | null): string {
  if (remainingSeconds === null) {
    return `rgba(${BASE_COLOR.r}, ${BASE_COLOR.g}, ${BASE_COLOR.b}, ${BASE_COLOR.a})`;
  }
  const t = Math.min(1, Math.max(0, (GRADIENT_SECONDS - remainingSeconds) / GRADIENT_SECONDS));
  const r = lerp(BASE_COLOR.r, URGENT_COLOR.r, t);
  const g = lerp(BASE_COLOR.g, URGENT_COLOR.g, t);
  const b = lerp(BASE_COLOR.b, URGENT_COLOR.b, t);
  const a = lerp(BASE_COLOR.a, URGENT_COLOR.a, t);
  return `rgba(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)}, ${a.toFixed(2)})`;
}

// Isolates the 1-second tick to this one small leaf component so it doesn't
// re-render the rest of the app every second.
export function Countdown({ closeTime }: { closeTime: number | null }) {
  const { text, remainingSeconds } = useCountdown(closeTime);
  return (
    <span className="app-countdown" style={{ color: countdownColor(remainingSeconds) }}>
      {text}
    </span>
  );
}
