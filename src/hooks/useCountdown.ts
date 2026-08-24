import { useEffect, useState } from "react";

// Ticks once a second so the countdown reads live without waiting on a
// server push — we already know closeTime, no need to round-trip for it.
export function useCountdown(closeTime: number | null): string {
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  if (closeTime === null) return "—:—";
  const remaining = Math.max(0, Math.floor(closeTime - now));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
