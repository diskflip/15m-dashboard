import { useCountdown } from "../hooks/useCountdown";

const CRITICAL_SECONDS = 2 * 60;
const WARN_SECONDS = 5 * 60;

function urgencyClass(remainingSeconds: number | null): string {
  if (remainingSeconds === null) return "";
  if (remainingSeconds <= CRITICAL_SECONDS) return "critical";
  if (remainingSeconds <= WARN_SECONDS) return "warn";
  return "";
}

// Isolates the 1-second tick to this one small leaf component so it doesn't
// re-render the rest of the app every second.
export function Countdown({ closeTime }: { closeTime: number | null }) {
  const { text, remainingSeconds } = useCountdown(closeTime);
  return <span className={`app-countdown ${urgencyClass(remainingSeconds)}`}>{text}</span>;
}
