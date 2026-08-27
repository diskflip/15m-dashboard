import { useEffect, useState } from "react";

export type CountdownState = {
  text: string;
  remainingSeconds: number | null;
};

// Ticks once a second so the countdown reads live without waiting on a
// server push — we already know closeTime, no need to round-trip for it.
export function useCountdown(closeTime: number | null): CountdownState {
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  if (closeTime === null) return { text: "—:—", remainingSeconds: null };
  const remaining = Math.max(0, Math.floor(closeTime - now));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return { text: `${minutes}:${seconds.toString().padStart(2, "0")}`, remainingSeconds: remaining };
}
