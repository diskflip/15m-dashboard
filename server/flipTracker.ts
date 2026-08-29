// A "flip" is a side trading down to LOW_CENTS and later back up to
// HIGH_CENTS within the same 15m market window.
const LOW_CENTS = 6;
const HIGH_CENTS = 85;
const ONE_HOUR_SECONDS = 3600;
const RETENTION_SECONDS = ONE_HOUR_SECONDS * 2;

type FlipEvent = {
  side: "yes" | "no";
  time: number;
  ticker: string;
};

export class FlipTracker {
  private armedYes = false;
  private armedNo = false;
  private currentTicker: string | null = null;
  private previousTicker: string | null = null;
  private events: FlipEvent[] = [];

  onMarketChange(ticker: string) {
    if (ticker === this.currentTicker) return;
    this.previousTicker = this.currentTicker;
    this.currentTicker = ticker;
    this.armedYes = false;
    this.armedNo = false;
  }

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

  countLastCompletedWindow(): number {
    if (!this.previousTicker) return 0;
    const ticker = this.previousTicker;
    return this.events.filter((e) => e.ticker === ticker).length;
  }
}
