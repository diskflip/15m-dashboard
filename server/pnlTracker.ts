// Session P&L for one market symbol. Resets to 0 every time this process
// starts. Amounts are added once per settled window — see
// portfolio.ts:realizedPnlFromSettlement for how each window's contribution
// is computed (and why it isn't based on the market's actual outcome).
export class PnlTracker {
  private sessionDollars = 0;

  add(amount: number) {
    this.sessionDollars += amount;
  }

  total(): number {
    return this.sessionDollars;
  }
}
