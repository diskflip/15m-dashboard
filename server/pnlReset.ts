import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESET_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".pnl-reset.json");

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// The daily P&L total is "everything settled since this cutoff", normally
// UTC midnight. resetPnlNow() moves it forward on demand; persisted to disk
// so it survives a process restart — see index.ts's seedTodaysPnl.
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
