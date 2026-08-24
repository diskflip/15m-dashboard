# Kalshi trading data — raw pulls + findings (as of 2026-08-18)

## What's in this package

- `raw-settlements.json` — every settled window on the account, last 7 days (2026-08-11 to 2026-08-18), all markets (BTC/DOGE/ETH/SILVER/GOLD/WTI/BTCD), SOL excluded. Pulled from Kalshi `/trade-api/v2/portfolio/settlements` (authenticated, account-specific).
- `raw-fills.json` — every individual fill on the account over the same 7 days. From `/trade-api/v2/portfolio/fills`.
- `silver-candles.json` — 1-minute OHLC candlesticks (price high/low/close per minute) for all 51 SILVER (`KXSILVER15M`) windows settled in the last 7 days. Public data, from `/trade-api/v2/series/KXSILVER15M/markets/{ticker}/candlesticks`, independent of the account — this is the actual market price path, not just our own trades.
- `silver-ticks.json` — true tick-by-tick trade prints (every public trade, with timestamp and yes-price) for a systematic 1-in-3 sample of those 51 SILVER windows (17 windows, ~20,000 individual trades). From `/trade-api/v2/markets/trades`. Used to sanity-check the minute-candle results against real second-by-second price action.
- `silver_grid_output.txt` / `silver_grid2_output.txt` — saved output of the entry/exit grid search described below.

## The strategy being run

Buy a side (YES or NO) of Kalshi's 15-minute up/down markets when it dips to **6c**, sell if it recovers to **85c** before the window closes, otherwise hold to settlement. Currently run live on BTC, DOGE, and SILVER.

## Account performance, last 7 days (all markets except SOL)

- Total net P&L: **+$1,650.60** across 404 settled windows (42 winners, 362 losers — profitable because winners are large, losers are small and frequent).
- By market: SILVER +$978, BTC +$730 (but ~$760 of that is a single outlier window on Aug 12 — excluding it, BTC is -$31 for the rest of the week), DOGE +$141, WTI -$117, ETH -$62, GOLD -$29.
- By day: strong Aug 12-15 (+$115 to +$1,158/day), then negative Aug 16-17 (-$175, -$194), roughly flat Aug 18.

## SILVER-specific analysis (the focus of the deep dive)

### Method note — a bug we found and fixed
An early pass computed "does price reach X after entry" using the high/low of the *same 1-minute candle* as the entry, which can look ahead (the high can occur before the low within that same minute — i.e. before the theoretical entry — inflating apparent take-profit opportunities). All numbers below use the corrected method: for take-profit search, only minutes *after* the entry minute are scanned. This was cross-checked against true tick-level data (`silver-ticks.json`) for a 17-window sample and the corrected minute-level numbers and tick-level numbers agree reasonably well.

### Is 6c the right entry?
Win-rate by entry threshold, hold-to-expiry, across all 51 SILVER windows this week:

| Entry | n | Win rate | Edge (cents) |
|---|---|---|---|
| 1c | 51 | 3.9% | +2.9 |
| 2c | 56 | 8.9% | +6.9 |
| 3c | 57 | 10.5% | +7.5 |
| 4c | 58 | 12.1% | +8.1 |
| 5c | 59 | 13.6% | +8.6 |
| **6c** | 63 | 19.0% | **+13.0** |
| 7c | 64 | 20.3% | +13.3 |
| 8c | 64 | 20.3% | +12.3 |
| 10c | 65 | 21.5% | +11.5 |
| 12c | 67 | 23.9% | +11.9 |
| **15c** | 71 | 28.2% | **+13.2** |
| 20c | 73 | 30.1% | +10.1 |
| 25c | 78 | 34.6% | +9.6 |
| 30c | 82 | 37.8% | +7.8 |

**Entries below ~5c are robustly worse** — win rate collapses faster than the cheaper price compensates; this gap is much larger than the sampling noise (±~5 points at these sample sizes) and looks real.

**6c, 7c, and 15c are statistically indistinguishable from each other** (~13c edge each) — with only 63-82 observations per row, the standard error on the win-rate estimate is roughly ±5 percentage points, larger than the 1-3c gaps between these rows. Don't trust any claim that one specific number in the 6-15c range is "the" optimum — that would be overfitting to this one week.

**The real, defensible lever: trade volume, not entry precision.** Loosening the gate from 6c to ~15c gets ~13% more opportunities (71 vs 63 this week) at statistically the same edge. Since edge doesn't degrade until past ~20c, trading the whole 6-15c band instead of only the tightest 6c corner is a legitimate way to increase total profit without sacrificing per-trade quality.

### Exit: 85c vs other targets
Every entry level tested shows a small, consistent improvement from capping the exit around 95c instead of holding all the way to literal settlement:

| Entry | hold-to-expiry | exit@95c |
|---|---|---|
| 6c | +13.05c | +13.84c |
| 7c | +13.31c | +14.02c |
| 15c | +13.17c | +15.92c |

Reason: a spike to 90c+ still reverses back under 20c about 31% of the time before the window closes (measured directly). Selling at 95c instead of riding to expiry gives up at most 5c on the rare full-100 outcomes but avoids the reversal cases. This showed up consistently, not on one cherry-picked row.

Full entry×exit grid (14 entries × 14 exits, min n=5) is in `silver_grid_output.txt`. Top result was 15c/95c at +15.92c/contract vs the 6c/85c baseline's +12.25c/contract — but per the noise discussion above, treat the exact ranking with caution; the broad pattern (6-15c entry band, exit near 90-95c beats exit at 85c or full hold) is the trustworthy part, not the single top row.

### Other things tested, without a clear robust edge
- **Momentum/breakout entry** (buying the side already trading ≥70-95c instead of the cheap dip): consistently negative EV (-7.8c to -13.2c/contract) despite high win rates (62-86%) — the market prices that momentum efficiently, no edge there.
- **Time-remaining filter** on the 6c entry (does it matter how much of the 15 minutes is left when you enter): sample sizes per time-bucket were too small (n=1 to 19) to draw any real conclusion — flagged as inconclusive, not negative.
- **Multi-touch scalping**: only 27% of windows offer more than one separate ≤6c dip, so repeat-entry scalping within a single window has limited opportunity surface.

## BTC 15m regime-gate analysis (as of 2026-08-23/24)

Pulled fresh via `pull_btc_settlements.ts` / `pull_btc_fills.ts` (authenticated,
last 5 days) and `btc_regime_analysis.ts` (matches each settled BTC 15m window
to its entry fill, then pulls the public 1-min candlesticks for the 5 minutes
before entry to compute a "pre-entry range" — the idea being a possible regime
gate: only take the 6c dip if recent volatility is above some cents threshold).
Raw output: `btc-settlements.json`, `btc-fills.json`, `btc-regime-trades.json`.

**Note on fills data:** this account's BTC dip-buy enters on *either* side.
YES-side entries show as `action=buy, side=yes`. NO-side entries show as
`action=sell, side=no` but always at a fixed ~6c `no_price` — not a variable
high-price exit — so both fill patterns are entries, not entry+exit pairs. No
separate take-profit exit fills exist in this data; every position is held to
settlement.

### Headline result: no range threshold rescues this — BTC's edge is currently gone

47 settled BTC 15m windows, 5 days, entries at 5-12c (avg 6.2c): **1 win, 46
losses, net -$338.83.** Win rate 2.1% vs. a ~6.2% breakeven at this average
entry price — well below breakeven, not just under SILVER's ~19% baseline.

| Pre-entry range (5min) | N | Wins | Win% | Net P&L |
|---|---|---|---|---|
| 10-20c | 1 | 0 | 0% | -$19.98 |
| 20-30c | 6 | 0 | 0% | -$55.80 |
| 30-50c | 17 | 0 | 0% | -$144.50 |
| 50c+ | 23 | 1 | 4.3% | -$118.55 |

Every bucket loses money. Losses are consistent across all 5 days
individually (no single bad day driving it) and across both entry sides
(yes: 0/27 wins, no: 1/20 wins) — this isn't a one-off trending day, it looks
like a structural edge collapse specific to BTC right now.

**Why the range gate doesn't work: entries only ever fire in the last <5
minutes of the window** (observed range 0.5–4.9 min remaining at entry,
median ~1.7 min). By definition the "range over the previous 5 minutes"
mostly *is* the window's whole visible price history by the time the 6c dip
appears — there's rarely enough time left afterward for a reversal regardless
of how that range is bucketed. This differs from the SILVER analysis
mechanism, though the timing pattern there wasn't checked and might be
similar — worth re-running the same `minutesRemaining` check against
`silver-candles.json` before assuming SILVER is different.

**Recommendation:** don't tune a range threshold on this data — there's no
bucket with positive edge to preserve. Two directions worth checking before
resuming BTC 6c entries at any range: (1) whether this is a temporary regime
shift (re-check in a few days) or a persistent one, and (2) whether a
*minimum time-remaining* filter (e.g. don't enter with <3 min left) does more
than range ever could, since every single entry in this sample already has
less than 5 minutes on the clock.

### Honest caveats
- 47 trades is a real sample, not noise-explainable at 1/47 wins vs a ~6%
  breakeven — but it's still one 5-day window on one market. Could reflect a
  short-lived choppy/trending regime specific to this week.
- Range was computed from public 1-min candlestick `price.high/low` (last
  trade price), not the executable yes-ask specifically — shouldn't change
  the bucket conclusions since the effect (no separation at all) is far
  larger than that methodology choice could account for.

## Honest caveats for whoever analyzes this next
- Sample is one week, one market (SILVER) for the deep dive. Regime can shift; re-run before trusting any specific number going forward.
- `silver-candles.json` covers all 51 windows but only at 1-minute resolution. `silver-ticks.json` has true tick resolution but only for 17 of those windows (systematic sample, not cherry-picked).
- The account-level `raw-settlements.json`/`raw-fills.json` reflect the actual current strategy's live results; the `silver-candles.json`/`silver-ticks.json` are independent public market data used to backtest hypothetical alternative entry/exit rules against real price action.
