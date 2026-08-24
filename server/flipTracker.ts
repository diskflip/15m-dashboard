// Tracks "flips" for one market symbol: a side (YES or NO) trading down to
// LOW_CENTS and later trading back up to HIGH_CENTS within the same 15m
// market window — the swing a bot would want to catch (buy cheap, exit
// rich). Counts are kept per-market-window (each 15m ticker is technically
// a separate Kalshi market) so "flips in the last completed window" is a
// clean, comparable-across-windows signal, distinct from a rolling
// clock-time count.
const LOW_CENTS = 6;
const HIGH_CENTS = 85;
const ONE_HOUR_SECONDS = 3600;
// Bound memory: no need to remember flips older than what the rolling
// window queries below will ever ask for.
const RETENTION_SECONDS = ONE_HOUR_SECONDS * 2;

type FlipEvent = {
  side: "yes" | "no";
  time: number; // unix seconds
  ticker: string;
};

export class FlipTracker {
  private armedYes = false;
  private armedNo = false;
  private currentTicker: string | null = null;
  private previousTicker: string | null = null;
  private events: FlipEvent[] = [];

  // Call when the active 15m market rolls over. Each window starts with a
  // clean slate for arming — a low touch in the old window doesn't carry
  // over to count as a flip in the new one.
  onMarketChange(ticker: string) {
    if (ticker === this.currentTicker) return;
    this.previousTicker = this.currentTicker;
    this.currentTicker = ticker;
    this.armedYes = false;
    this.armedNo = false;
  }

  // Call on every price tick (yes = YES bid, in cents). Returns true if a
  // new flip was just recorded, so the caller can rebroadcast immediately.
  onPrice(yes: number): boolean {
    if (!this.currentTicker) return false;
    const no = 100 - yes;
    let flipped = false;

    if (yes <= LOW_CENTS) this.armedYes = true;
    if (this.armedYes && yes >= HIGH_CENTS) {
      this.record("yes");
      this.armedYes = false;
      flipped = true;
    }

    if (no <= LOW_CENTS) this.armedNo = true;
    if (this.armedNo && no >= HIGH_CENTS) {
      this.record("no");
      this.armedNo = false;
      flipped = true;
    }

    return flipped;
  }

  private record(side: "yes" | "no") {
    if (!this.currentTicker) return;
    this.events.push({ side, time: Math.floor(Date.now() / 1000), ticker: this.currentTicker });
    const cutoff = Math.floor(Date.now() / 1000) - RETENTION_SECONDS;
    while (this.events.length > 0 && this.events[0].time < cutoff) {
      this.events.shift();
    }
  }

  countLastHour(): number {
    const cutoff = Math.floor(Date.now() / 1000) - ONE_HOUR_SECONDS;
    return this.events.filter((e) => e.time >= cutoff).length;
  }

  // Flips in the most recently *completed* window, not the one still live —
  // a market can't be judged on flips yet until it's actually closed.
  countLastCompletedWindow(): number {
    if (!this.previousTicker) return 0;
    const ticker = this.previousTicker;
    return this.events.filter((e) => e.ticker === ticker).length;
  }
}
