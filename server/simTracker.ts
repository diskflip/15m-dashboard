// Paper-trades a configurable dip-buy/take-profit strategy against a
// market's live price feed — session-only, no real money or orders
// involved. A side touching entryCents arms it; touching exitCents while
// armed resolves it as a win.
type Side = {
  armed: boolean;
  entryCents: number | null;
};

export type SimTrade = {
  side: "yes" | "no";
  result: "win" | "loss";
  entryCents: number;
  profitDollars: number;
  time: number; // unix seconds
};

export class SimTracker {
  private yes: Side = { armed: false, entryCents: null };
  private no: Side = { armed: false, entryCents: null };
  private currentTicker: string | null = null;
  private totalDollars = 0;
  private wins = 0;
  private losses = 0;
  private lastTrade: SimTrade | null = null;
  // Trimmed to the rolling window every time snapshot() is read.
  private trades: SimTrade[] = [];

  constructor(
    private readonly entryCents = 6,
    private readonly exitCents = 95,
    private readonly betDollars = 1,
    private readonly windowSeconds = 3600,
  ) {}

  // A position still armed at rollover never hit its exit — same as being
  // held to expiry without a take-profit: the bet is lost.
  onMarketChange(ticker: string) {
    if (ticker === this.currentTicker) return;
    if (this.yes.armed) this.resolve("yes", "loss", this.yes.entryCents!);
    if (this.no.armed) this.resolve("no", "loss", this.no.entryCents!);
    this.currentTicker = ticker;
  }

  // Returns true if a trade just resolved, so the caller can rebroadcast.
  onPrice(yesCents: number): boolean {
    if (!this.currentTicker) return false;
    const noCents = 100 - yesCents;
    let resolved = false;

    if (!this.yes.armed && yesCents > 0 && yesCents <= this.entryCents) {
      this.yes = { armed: true, entryCents: yesCents };
    } else if (this.yes.armed && yesCents >= this.exitCents) {
      this.resolve("yes", "win", this.yes.entryCents!);
      resolved = true;
    }

    if (!this.no.armed && noCents > 0 && noCents <= this.entryCents) {
      this.no = { armed: true, entryCents: noCents };
    } else if (this.no.armed && noCents >= this.exitCents) {
      this.resolve("no", "win", this.no.entryCents!);
      resolved = true;
    }

    return resolved;
  }

  private resolve(side: "yes" | "no", result: "win" | "loss", entryCents: number) {
    const profitDollars =
      result === "win" ? this.betDollars * (this.exitCents / entryCents - 1) : -this.betDollars;
    this.totalDollars += profitDollars;
    if (result === "win") this.wins++;
    else this.losses++;
    this.lastTrade = {
      side,
      result,
      entryCents,
      profitDollars,
      time: Math.floor(Date.now() / 1000),
    };
    this.trades.push(this.lastTrade);
    if (side === "yes") this.yes = { armed: false, entryCents: null };
    else this.no = { armed: false, entryCents: null };
  }

  // Armed positions are left alone; only the tally resets.
  reset() {
    this.totalDollars = 0;
    this.wins = 0;
    this.losses = 0;
    this.lastTrade = null;
    this.trades = [];
  }

  snapshot() {
    const cutoff = Math.floor(Date.now() / 1000) - this.windowSeconds;
    this.trades = this.trades.filter((t) => t.time >= cutoff);
    const windowDollars = this.trades.reduce((sum, t) => sum + t.profitDollars, 0);
    return {
      totalDollars: this.totalDollars,
      windowDollars,
      wins: this.wins,
      losses: this.losses,
      lastTrade: this.lastTrade,
    };
  }
}
