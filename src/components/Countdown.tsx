import { useCountdown } from "../hooks/useCountdown";

const CRITICAL_SECONDS = 2 * 60;
const WARN_SECONDS = 5 * 60;

function urgencyClass(remainingSeconds: number | null): string {
  if (remainingSeconds === null) return "";
  if (remainingSeconds <= CRITICAL_SECONDS) return "critical";
  if (remainingSeconds <= WARN_SECONDS) return "warn";
  return "";
}

// Isolates the 1-second tick to this one small leaf component. It used to
// live directly in App() via useCountdown(closeTime) there, which meant
// every tick re-rendered the entire app — all six chart cards (each
// rebuilding SVG paths over up to thousands of history points) plus their
// framer-motion layout wrappers (each doing a getBoundingClientRect
// measurement pass) — once a second, forever, for as long as the tab stayed
// open. That's a real, continuous, unbounded cost with nothing to do with
// the actual countdown text, and a very plausible cause of a tab
// progressively bogging down/crashing after sustained use.
export function Countdown({ closeTime }: { closeTime: number | null }) {
  const { text, remainingSeconds } = useCountdown(closeTime);
  return <span className={`app-countdown ${urgencyClass(remainingSeconds)}`}>{text}</span>;
}
