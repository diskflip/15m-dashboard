import { useCountdown } from "../hooks/useCountdown";

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
  const countdown = useCountdown(closeTime);
  return <span className="app-countdown">{countdown}</span>;
}
