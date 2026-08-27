# BTC entrance-regime detector — painted-area backtest (as of 2026-08-25)

## What this is

A backtest of a proposed entry gate for the 6¢-in/95¢-out BTC 15m scalp: measure the
"painted area" between BTC's actual price and the window's strike (and, separately,
the Kalshi YES price vs 50¢) over various lookback windows, and see whether that
predicts which 6¢ entries go on to win vs lose. Read-only throughout — no orders
placed, cancelled, or modified; the live bot is untouched. Supersedes the
`## BTC 15m regime-gate analysis` section of `FINDINGS.md` (which used a cruder
"5-minute price range" feature over a 5-day, 1-win sample) with a proper 2-month
reconstruction and a much richer feature set.

**Code**: `paintedArea.ts` (feature engine), `build_btc_trades.ts` (trade
reconstruction), `fetch_kraken_history.ts` / `fetch_kalshi_candles.ts` (price
history), `analyze_painted_area.ts` / `validate_crossing_gates.ts` (backtest).
`entryRegimeGate.ts` is the portable, feature-flagged-off gate for the live bot.
`server/regimeLogger.ts` is the forward data logger.

## The trade data

Reconstructed **1,155 real BTC entries at 1-10¢** (median 8¢) from your actual
account history — `/portfolio/orders`, `/portfolio/fills`, `/portfolio/settlements`,
paginated back to the API's retention limit (**2026-06-19 to 2026-08-25**, 64
trading days). This is dramatically more data than the old 47-trade/5-day snapshot.

**Two real bugs found and fixed while reconstructing this**, both worth knowing
about if anyone touches this data again:
1. An inverted exit-price column (read the wrong side's price, turning real wins
   into apparent losses in an early pass).
2. This bot's "exit" mechanism isn't a literal sell of the held side — it **buys
   the opposite side once *it* gets cheap** (e.g., after buying NO at 6¢, once
   YES also drops to a few cents it buys YES too; 1 YES + 1 NO always settles for
   a guaranteed $1, so this locks in profit without ever "selling"). This is
   mathematically equivalent to selling the held side at `100 - (opposite
   price)`, but only if the hedge size matches the remaining position exactly —
   a naive read that assumed a 1:1 match badly mis-priced partial hedges (a
   ladder that only covers 1 of 8 contracts, say). Fixed by sequentially
   consuming each hedge fill against the remaining entry size and sending
   whatever's left to settlement for its own $1-or-$0 payout.

**Excluded from the clean set** (written separately to
`btc_trades_dual_sided_excluded.json`): ~5% of windows (62/1225) where *both*
YES and NO got a 6¢-ish entry in the same window — attributing shared hedge/
settlement legs back to two concurrent bets adds real ambiguity for a small
slice of data, and it contradicts your own "one side at a time" framing anyway.

**Baseline over the clean 1,155 trades: 142 wins / 1,013 losses, net −$1,001.65.**
One single day (2026-08-12, 8 trades) contributes +$931.88 of that, including one
+$760.79 trade — excluding that one day, the baseline is **−$1,933.53**. Every
number below is reported both ways where it matters.

## Data availability — what's real, what's approximated, what's missing

- **BTC-vs-strike**: real tick-level BTC/USD trades from **Kraken's public API**
  (Binance returned HTTP 451 — geo-blocked from this environment). Full coverage,
  all 1,155 trades, all 11 lookbacks (5s–900s), continuous across window
  boundaries as instructed (re-based to each window's own strike, not stitched
  YES-price history). This is the signal with real seconds-level fidelity.
- **YES-vs-50¢**: Kalshi's public trades endpoint is genuinely tick-level, but
  **too dense to page through cheaply** — a single 1000-trade page barely covers
  10-70 seconds of history near a typical entry time (100+ trades/sec right
  before close). Used **1-minute public candlesticks** instead (Kalshi's
  candlestick API doesn't go finer than 1 minute — confirmed, not assumed), and
  only for lookbacks **≥300s**, where a handful of 1-minute bars is a defensible
  (not great) approximation. **Lookbacks below 300s for the YES-vs-50 signal are
  NOT computed from history** — flagged as unavailable rather than faked.
  Coverage also shrinks at long lookbacks for early-window entries (can't extend
  before window open) — e.g. only 46 wins/323 losses have a full 900s YES
  history, vs 133/989 at 300s.
- **Placement time vs. fill time**: median gap between placing the 6¢ order and
  it actually filling is **118 seconds** (only 12.5% fill within 15s, 35.5%
  within 60s — full distribution in the conversation). All features below are
  computed at **fill time**. A gate on a lookback shorter than that placement-
  to-fill gap (i.e. under ~1-2 min) is only realistic live if the bot
  continuously re-checks and cancels/replaces the resting order — which, per the
  order data, it already roughly does (~10-60s replace cadence observed), just
  not tightly enough to guarantee catching a 5-15s window. Gates at 300s+
  lookback don't have this problem: the window is long enough that placement-
  time and fill-time evaluation look nearly the same regardless.

## Lookback ranking

For the feature that actually held up (crossing count — see below), **300-600s
(5-10 minutes) separated winners from losers best**. Very short lookbacks (≤60s)
were noisier (any "best" result there came from extreme, thin-sample thresholds —
see overfitting note). 900s was *worse*, not better: over a nearly-full 15-minute
window almost every trade has *some* crossing somewhere, so the feature loses
its discriminating power (a `crossingCount(900s)≥1` gate only rejects 98/1013
losers — barely better than nothing). A full 15-minute background alone is not
the answer; neither is pure short-term noise. The middle distance won.

## Most predictive features

By far the strongest, most stable signal across both the BTC-vs-strike and
YES-vs-50 signals (independently, at 600s) was simply: **has the reference line
actually been crossed at least once or twice recently?** i.e. `crossingCount` /
`completedLobes`. Balance and two-sided-area-score picked out similar trades but
with much more extreme, thin-sample thresholds (see below). Max-excursion-below
at 180s also showed a real, if smaller, effect. Deep-crossing (hysteresis 20¢/80¢-
equivalent) and imbalance/current-run-length were not independently useful once
crossing count is accounted for — they're correlated with it, not adding much on
top.

## The overfitting trap this backtest walked into (and around)

The single best-looking "improvements" from a raw threshold sweep were things
like `btc/90s balance ≥ 0.58` — **keeping only 18 of 142 winners** while removing
915/1013 losers, for a nominal +$1,869. That is exactly the failure mode you
warned about: a threshold so tight it keeps ~10% of all trades, and the dollar
result is dominated by whichever 2-5 trades happened to survive. On the
chronological holdout split, its best-performing siblings kept as few as **2 of
15 holdout winners** — not a real signal, a lucky handful of trades. **These are
reported in the code output but explicitly not recommended.**

The `crossingCount`-based gates are different in kind: thresholds are small
integers (≥1, ≥2), not fitted percentiles, so there's no fine-tuning to overfit
to, and the *same* rule was checked against completely independent evidence — a
different reference line (YES-vs-50¢, not just BTC-vs-strike) — and it held up
there too.

**The honest caveat that matters most**: on the **train slice alone** (first 70%
of days by date, before 2026-08-06), *every* gate tested — including the
crossing-count family — still leaves the strategy **net negative**. The
apparent full-sample/holdout profitability is partly a friendlier second-half
regime and partly the one Aug-12 outlier trade, not something the gate caused.
What *does* replicate consistently across train/holdout/with-or-without-the-
outlier is the **size of the improvement** (loss reduction), not an outright
flip to profitability. Say this plainly to yourself before deploying anything
here: **this reduces how much BTC loses; it has not been shown to make BTC
win.**

## Three candidate gates (BTC-vs-strike `crossingCount`, all real $, real fees, real quantities)

| Gate | Winners kept | Losers removed | Full sample ($) | Train-only ($) | Holdout ($) | Max drawdown | Worst losing streak |
|---|---|---|---|---|---|---|---|
| **Conservative**: `crossingCount(600s) ≥ 1` | 117/142 (82%) | 244/1013 (24%) | −1002 → +21 (+1022) | −1128 → −737 (+391) | +126 → +757 (+632) | $869 | 47 |
| **Balanced**: `crossingCount(600s) ≥ 2` | 88/142 (62%) | 454/1013 (45%) | −1002 → +418 (+1419) | −1128 → −650 (+477) | +126 → +1068 (+942) | $741 | 37 |
| **Aggressive**: `crossingCount(120s) ≥ 1` | 51/142 (36%) | 653/1013 (64%) | −1002 → +539 (+1541) | −1128 → −274 (+854) | +126 → +813 (+687) | $425 | 42 |

("Full sample" and "holdout" figures include the Aug-12 outlier day; excluding
it, the Conservative gate's improvement is essentially unchanged, +$1,022 vs
+$1,022 — the *delta* doesn't depend on that one day even though the absolute
level does.)

Combined rules you specifically asked for (BTC-vs-strike, medians as thresholds):

| Rule | Winners kept | Losers removed | Improvement |
|---|---|---|---|
| 900s two-sided background (≥ median) + strong last-60s activity (≥ median) | 37/142 | 709/1013 | +$286 |
| Strong 90s area score (≥ median) + ≥1 deep crossing in last 120s | 7/142 | 988/1013 | +$1,030 (but only 7 winners left — same thin-sample problem) |
| Balanced 300s area (≥ median) but rejected if last 30s has zero crossings | 11/142 | 947/1013 | +$1,599 (same problem) |

The first combined rule is closest to being reasonable and still isn't as clean
as the plain crossing-count gates above.

## Recommendation

**Start with the Conservative gate — `crossingCount(600s) ≥ 1` — if you test
anything live.** It keeps 82% of winners (you give up very few real wins),
removes a quarter of losers, its improvement is the *smallest* of the three but
also the *least sensitive* to the Aug-12 outlier and to threshold choice
(integer ≥1, nothing to overfit), and it's the simplest possible version of "did
BTC actually move both ways recently, or has it just been glued to one side" —
which is intuitively exactly what you'd want a 6¢ dip-buy to require. Do **not**
expect it to make BTC profitable outright; expect it to make it lose
meaningfully less, consistently.

The Balanced and Aggressive gates showed larger nominal improvements but remove
substantially more winners to get there, and (Aggressive especially) haven't
been checked against as much independent corroboration. If Conservative holds
up over the next few weeks of real (or forward-logged) data, Balanced is the
natural next step to test — not Aggressive.

## What to build now (forward logger)

`server/regimeLogger.ts` — run standalone (`npx tsx server/regimeLogger.ts`),
alongside or instead of the dashboard, with zero effect on live trading (it only
subscribes/polls and appends to `logs/regime-*.jsonl`):
- Kalshi's own ticker feed, tick-by-tick (not the 1-minute candle proxy this
  backtest had to use for YES-vs-50 below 300s).
- Kraken's public BTC/USD trade feed, tick-by-tick.
- Market rollovers (strike, open/close) whenever the window changes.
- Every real fill (undeduped — the dashboard's fill feed intentionally dedupes
  for sound purposes, this logger doesn't).
- New order placements (polled every 5s — Kalshi has no push channel for this,
  confirmed).

Run this for a few weeks and the YES-vs-50 signal can finally be tested at the
same short lookbacks BTC-vs-strike got here.

## Implementation sketch (feature-flagged off)

`scripts/entryRegimeGate.ts` — pure functions, one internal import
(`paintedArea.ts`'s math), portable to the actual bot's codebase as-is.
**`enabled: false` by default** — until switched on, `evaluateEntryGate()` is a
no-op pass-through, identical to current behavior.

```ts
import { evaluateEntryGate, defaultGateConfig } from "./entryRegimeGate";
// defaultGateConfig currently mirrors the Conservative gate above, disabled.

function shouldPlaceEntry(side: "yes" | "no", nowUnixSeconds: number): boolean {
  const gate = evaluateEntryGate(recentBtcTicks, strike, nowUnixSeconds, defaultGateConfig);
  if (!gate.allow) {
    log(`[entry-gate] skipped ${side}: ${gate.reason}`);
    return false;
  }
  return true; // existing 6c-touch placement logic runs as normal
}
```

Call this right before placing (or re-placing) the resting 6¢ order, and again
before leaving an already-resting order in place — if the gate would now say no,
cancel it. That continuous re-check is what makes fill-time gating realistic
given the ~118s median placement-to-fill gap.

## Honest summary

No gate tested — including the ones recommended above — turns this into a
profitable strategy on the *train* slice of real history. The crossing-count
family is the one genuinely stable finding (small integer thresholds, holds up
with or without the one big outlier day, corroborated independently by both the
BTC-vs-strike and YES-vs-50¢ signals) and is worth testing live specifically
*as a loss-reducer*, not as a fix. Everything with a bigger headline number
either evaporates on holdout or was never real to begin with (2-5 surviving
trades driving the whole result). If you want a bigger structural answer than
"lose somewhat less," the more likely lever — per the account-level breakdown
in the original `FINDINGS.md` — is that BTC's edge right now is just weak
compared to SILVER's, and no entry-timing filter fixes that; it would need
either a real regime recovery or accepting BTC as a smaller, gate-filtered
allocation rather than a fix-it target.
