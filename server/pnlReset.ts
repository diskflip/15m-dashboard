import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESET_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".pnl-reset.json");

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// The on-screen daily P&L total is normally "everything settled since UTC
// midnight" — this lets that starting point move forward on demand (e.g.
// "start fresh for the rest of today"), persisted to disk so it survives a
// process restart (tsx watch reloads constantly during dev, and the total
// is reseeded from this cutoff every time — see index.ts's seedTodaysPnl).
export function getPnlSince(): Date {
  try {
    const { since } = JSON.parse(fs.readFileSync(RESET_FILE, "utf8"));
    return new Date(since);
  } catch {
    return startOfUtcDay(new Date());
  }
}

export function resetPnlNow(): Date {
  const now = new Date();
  fs.writeFileSync(RESET_FILE, JSON.stringify({ since: now.toISOString() }));
  return now;
}
