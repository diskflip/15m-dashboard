// Paper-trades the 6c-dip / 95c-exit strategy against this market's live
// price feed — session-only, no real money or orders involved. Same
// armed/resolved shape as FlipTracker (a side touching ENTRY_CENTS "arms"
// it, touching EXIT_CENTS while armed resolves it), but tracks a simulated
// $ P&L instead of just counting flips, so the dashboard can show what your
// bots *would* be making right now if they were actually running — a live
// read on whether current conditions are worth turning them on for.
const ENTRY_CENTS = 6;
const EXIT_CENTS = 95;
const BET_DOLLARS = 5;

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
  // Full trade history (session-long) just to derive the rolling last-hour
  // figure shown alongside the running total — trimmed of anything older
  // than an hour every time it's read, not on a timer.
  private trades: SimTrade[] = [];

  // Call when the active 15m market rolls over. Anything still armed going
  // into the rollover never reached the exit target before the window
  // closed — same fate as a real position held to expiry without hitting
  // its take-profit: the bet is lost.
  onMarketChange(ticker: string) {
    if (ticker === this.currentTicker) return;
    if (this.yes.armed) this.resolve("yes", "loss", this.yes.entryCents!);
    if (this.no.armed) this.resolve("no", "loss", this.no.entryCents!);
    this.currentTicker = ticker;
  }

  // Call on every price tick (yes = YES bid, in cents). Returns true if a
  // trade just resolved, so the caller can rebroadcast immediately.
  onPrice(yesCents: number): boolean {
    if (!this.currentTicker) return false;
    const noCents = 100 - yesCents;
    let resolved = false;

    if (!this.yes.armed && yesCents > 0 && yesCents <= ENTRY_CENTS) {
      this.yes = { armed: true, entryCents: yesCents };
    } else if (this.yes.armed && yesCents >= EXIT_CENTS) {
      this.resolve("yes", "win", this.yes.entryCents!);
      resolved = true;
    }

    if (!this.no.armed && noCents > 0 && noCents <= ENTRY_CENTS) {
      this.no = { armed: true, entryCents: noCents };
    } else if (this.no.armed && noCents >= EXIT_CENTS) {
      this.resolve("no", "win", this.no.entryCents!);
      resolved = true;
    }

    return resolved;
  }

  // $5 buys 5/entryPrice contracts, sold at EXIT_CENTS (not held to a $1
  // settlement — the strategy is a 95c take-profit exit, not holding to
  // expiry). A loss is just the bet, gone. Matches the account's real
  // 6c-in/95c-out shape, scaled to a fixed $5 stake so every simulated trade
  // is directly comparable.
  private resolve(side: "yes" | "no", result: "win" | "loss", entryCents: number) {
    const profitDollars =
      result === "win" ? BET_DOLLARS * (EXIT_CENTS / entryCents - 1) : -BET_DOLLARS;
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

  // Clears the session's paper-trading tally — armed positions are left
  // alone (a dip already being tracked shouldn't just vanish), only the
  // accumulated $ / win / loss counters and last-trade flash reset.
  reset() {
    this.totalDollars = 0;
    this.wins = 0;
    this.losses = 0;
    this.lastTrade = null;
    this.trades = [];
  }

  snapshot() {
    const cutoff = Math.floor(Date.now() / 1000) - 3600;
    this.trades = this.trades.filter((t) => t.time >= cutoff);
    const lastHourDollars = this.trades.reduce((sum, t) => sum + t.profitDollars, 0);
    return {
      totalDollars: this.totalDollars,
      lastHourDollars,
      wins: this.wins,
      losses: this.losses,
      lastTrade: this.lastTrade,
    };
  }
}
