import { useEffect, useRef, useState } from "react";
import { connectToBackend } from "../data/kalshi";
import "./ActivityLog.css";

type Entry = {
  id: number;
  symbol: string;
  intent: "entry" | "exit";
  side?: "yes" | "no";
  priceCents?: number;
};

const VISIBLE_MS = 6000;
let nextId = 1;

// A small, transient log of every real entry/exit fill across every
// tracked market — added specifically so a buy-in/win sound can always be
// traced back to exactly what traded (symbol, side, price) instead of
// having to trust sound-vs-visible-position-change correlation, which is
// easy to lose track of with several 15-minute markets rolling over (and
// trading) close together.
export function ActivityLog() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    const disconnect = connectToBackend(
      (msg) => {
        if (msg.type !== "fillEvent") return;
        const id = nextId++;
        const entry: Entry = {
          id,
          symbol: msg.symbol,
          intent: msg.intent,
          side: msg.side,
          priceCents: msg.priceCents,
        };
        setEntries((prev) => [entry, ...prev].slice(0, 8));
        timers.set(
          id,
          setTimeout(() => {
            setEntries((prev) => prev.filter((e) => e.id !== id));
            timers.delete(id);
          }, VISIBLE_MS)
        );
      },
      () => {}
    );

    return () => {
      disconnect();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="activity-log">
      {entries.map((e) => (
        <div key={e.id} className={`activity-entry ${e.intent}`}>
          <span className="activity-symbol">{e.symbol}</span>
          <span className="activity-detail">
            {e.intent === "entry" ? "bought" : "sold"}
            {e.side ? ` ${e.side.toUpperCase()}` : ""}
            {e.priceCents !== undefined ? ` @ ${e.priceCents}¢` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
