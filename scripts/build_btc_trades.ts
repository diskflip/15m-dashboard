// Reconstructs a canonical BTC 15m trade list from real account history:
// orders (placement + fill lifecycle), fills (exact fill time/price/fee),
// and settlements (final result for anything held to expiry). Read-only —
// pulls nothing live, just joins the already-pulled JSON dumps.
//
// Exit mechanics, reverse-engineered from real order/fill data (see
// scripts/probe_exits.ts, probe_sellyes.ts output): this bot does NOT sell
// the held side directly. It ladders in "scalpex{yes|no}{0..5}" orders that
// BUY THE OPPOSITE side once it gets cheap (e.g. after buying NO at 6c, once
// YES also gets cheap it buys YES too — 1 YES + 1 NO always settles for a
// guaranteed $1, so this is a lock-in, not a literal close). This is
// mathematically equivalent to "selling the held side at (100 - opposite
// price)", which is exactly the held side's OWN price column on that same
// order (both columns are always present and complementary) — so summing
// (heldSidePriceOnThatFill/100 * fillQty) across every scalpex* fill for the
// ticker gives the correct locked-in proceeds regardless of which named
// flavor fired. Any quantity never covered by a lock-in fill rides to
// settlement for its own $1-or-$0 payout. Verified against several real
// examples by hand (see conversation) before trusting this for the backtest.
//
// Simplification: tickers where BOTH sides show a scalpyes-/scalpno- entry
// in the same window (~5% of them) are excluded from the clean output — the
// user's own strategy is "one side at a time", and attributing shared
// hedge/settlement legs back to two concurrent entries adds real ambiguity
// for a small slice of the data. They're written separately for the record.
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../server/config.ts";

type Order = {
  ticker: string;
  client_order_id: string;
  order_id: string;
  action: string;
  side: string;
  outcome_side?: string;
  status: string;
  created_time: string;
  last_update_time: string;
  yes_price_dollars: string;
  no_price_dollars: string;
  fill_count_fp: string;
};

type Fill = {
  ticker: string;
  order_id: string;
  action: string;
  side: string;
  outcome_side: string;
  yes_price_dollars: string;
  no_price_dollars: string;
  count_fp: string;
  fee_cost: string;
  created_time: string;
};

type Settlement = {
  ticker: string;
  market_result: "yes" | "no" | "";
  yes_count_fp: string;
  no_count_fp: string;
  fee_cost?: string;
  settled_time: string;
};

function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function getJson(path: string, query = ""): Promise<any> {
  const res = await fetch(`${config.restBaseUrl}${path}${query}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status} ${text}`);
  return JSON.parse(text);
}

async function fetchMarketMeta(tickers: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  const CHUNK = 40;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const body = await getJson("/trade-api/v2/markets", `?tickers=${chunk.join(",")}`);
        for (const m of body.markets ?? []) out.set(m.ticker, m);
        break;
      } catch (e: any) {
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    if (i % 400 === 0) console.log(`  market meta: ${Math.min(i + CHUNK, tickers.length)}/${tickers.length}`);
  }
  return out;
}

async function main() {
  const orders: Order[] = loadJson("scripts/btc-orders-full.json").filter((o: Order) =>
    o.ticker?.startsWith("KXBTC15M")
  );
  const fills: Fill[] = loadJson("scripts/all-fills.json").filter((f: Fill) =>
    f.ticker?.startsWith("KXBTC15M")
  );
  const settlements: Settlement[] = loadJson("scripts/all-settlements.json").filter((s: Settlement) =>
    s.ticker?.startsWith("KXBTC15M")
  );
  console.log(`orders: ${orders.length}, fills: ${fills.length}, settlements: ${settlements.length}`);

  const fillsByOrderId = new Map<string, Fill[]>();
  for (const f of fills) {
    if (!fillsByOrderId.has(f.order_id)) fillsByOrderId.set(f.order_id, []);
    fillsByOrderId.get(f.order_id)!.push(f);
  }
  const settlementByTicker = new Map<string, Settlement>();
  for (const s of settlements) settlementByTicker.set(s.ticker, s);

  const entryOrders = orders.filter(
    (o) => o.status === "executed" && /^(scalpyes|scalpno)-/.test(o.client_order_id ?? "")
  );
  const exitOrders = orders.filter(
    (o) => o.status === "executed" && /^scalpex(yes|no)\d/.test(o.client_order_id ?? "")
  );
  console.log(`executed entry legs: ${entryOrders.length}, executed exit/hedge legs: ${exitOrders.length}`);

  // ticker -> side -> entry order legs (usually 1, occasionally split across
  // a couple of orders if the fill happened in pieces)
  const entryLegsByTicker = new Map<string, Map<"yes" | "no", Order[]>>();
  for (const o of entryOrders) {
    const side: "yes" | "no" = o.client_order_id!.startsWith("scalpyes") ? "yes" : "no";
    if (!entryLegsByTicker.has(o.ticker)) entryLegsByTicker.set(o.ticker, new Map());
    const bySide = entryLegsByTicker.get(o.ticker)!;
    if (!bySide.has(side)) bySide.set(side, []);
    bySide.get(side)!.push(o);
  }

  const dualSidedTickers = new Set<string>();
  for (const [ticker, bySide] of entryLegsByTicker) {
    if (bySide.size > 1) dualSidedTickers.add(ticker);
  }
  console.log(`dual-sided tickers excluded from clean set: ${dualSidedTickers.size}`);

  // ticker -> every scalpex* fill's (time, entrySide-equivalent priceCents,
  // qty, fee) — priced using the entry side's own price column, which is
  // present and correct regardless of which named flavor fired (see header).
  const exitFillsByTicker = new Map<
    string,
    Array<{ time: string; yesEquivCents: number; noEquivCents: number; qty: number; fee: number }>
  >();
  for (const o of exitOrders) {
    const fillsForOrder = fillsByOrderId.get(o.order_id) ?? [];
    const rows = fillsForOrder.length > 0
      ? fillsForOrder.map((f) => ({
          time: f.created_time,
          yesEquivCents: Math.round(parseFloat(f.yes_price_dollars) * 10000) / 100,
          noEquivCents: Math.round(parseFloat(f.no_price_dollars) * 10000) / 100,
          qty: parseFloat(f.count_fp),
          fee: parseFloat(f.fee_cost || "0"),
        }))
      : [
          {
            time: o.last_update_time,
            yesEquivCents: Math.round(parseFloat(o.yes_price_dollars) * 10000) / 100,
            noEquivCents: Math.round(parseFloat(o.no_price_dollars) * 10000) / 100,
            qty: parseFloat(o.fill_count_fp),
            fee: 0,
          },
        ];
    if (!exitFillsByTicker.has(o.ticker)) exitFillsByTicker.set(o.ticker, []);
    exitFillsByTicker.get(o.ticker)!.push(...rows);
  }
  for (const rows of exitFillsByTicker.values()) rows.sort((a, b) => a.time.localeCompare(b.time));

  const uniqueTickers = [...entryLegsByTicker.keys()];
  console.log(`unique tickers with an entry: ${uniqueTickers.length}. Fetching market metadata...`);
  const meta = await fetchMarketMeta(uniqueTickers);
  console.log(`got metadata for ${meta.size} tickers`);

  const trades: any[] = [];
  const excludedDualSided: any[] = [];

  for (const [ticker, bySide] of entryLegsByTicker) {
    const m = meta.get(ticker);
    if (!m) {
      console.warn(`  no market metadata for ${ticker}, skipping`);
      continue;
    }
    const strike = m.floor_strike ?? m.cap_strike ?? null;
    const closeTime = m.close_time;
    const openTime = m.open_time;
    const settlement = settlementByTicker.get(ticker);
    const isDual = bySide.size > 1;

    for (const [side, legs] of bySide) {
      legs.sort((a, b) => a.created_time.localeCompare(b.created_time));
      const fillsForLegs = legs.flatMap((l) => fillsByOrderId.get(l.order_id) ?? []);
      const totalCount = fillsForLegs.length > 0
        ? fillsForLegs.reduce((s, f) => s + parseFloat(f.count_fp), 0)
        : legs.reduce((s, l) => s + parseFloat(l.fill_count_fp), 0);
      const entryFeeDollars = fillsForLegs.reduce((s, f) => s + parseFloat(f.fee_cost || "0"), 0);
      const weightedPriceCents = fillsForLegs.length > 0
        ? fillsForLegs.reduce(
            (s, f) => s + parseFloat(side === "yes" ? f.yes_price_dollars : f.no_price_dollars) * 100 * parseFloat(f.count_fp),
            0
          ) / totalCount
        : parseFloat(side === "yes" ? legs[0].yes_price_dollars : legs[0].no_price_dollars) * 100;
      const allFillTimes = fillsForLegs.map((f) => f.created_time).sort();
      const firstOrderPlacedTime = legs[0].created_time;
      const entryFillTime = allFillTimes[allFillTimes.length - 1] ?? legs[legs.length - 1].last_update_time;
      const entryCostDollars = (weightedPriceCents / 100) * totalCount;

      // Consume ladder/hedge fills sequentially against this entry's size.
      const rungs = exitFillsByTicker.get(ticker) ?? [];
      let remaining = totalCount;
      let lockedProceeds = 0;
      let exitFeeDollars = 0;
      let lastLockTime: string | null = null;
      let anyLockFills = false;
      for (const r of rungs) {
        if (remaining <= 1e-6) break;
        const take = Math.min(r.qty, remaining);
        const priceCents = side === "yes" ? r.yesEquivCents : r.noEquivCents;
        lockedProceeds += (priceCents / 100) * take;
        // Attribute fee proportionally to the portion of this fill consumed.
        exitFeeDollars += r.fee * (take / r.qty);
        remaining -= take;
        lastLockTime = r.time;
        anyLockFills = true;
      }

      let exitReason: "take_profit_exit" | "partial_exit_plus_settlement" | "settlement";
      let remainderPayout = 0;
      let settlementFeeDollars = 0;
      if (remaining > 1e-6) {
        if (!settlement) {
          // Position not fully locked in and no settlement record found —
          // most likely the window hasn't settled yet (still open/recent).
          continue;
        }
        const won = settlement.market_result === side;
        remainderPayout = won ? remaining * 1.0 : 0;
        settlementFeeDollars = parseFloat(settlement.fee_cost ?? "0");
        exitReason = anyLockFills ? "partial_exit_plus_settlement" : "settlement";
      } else {
        exitReason = "take_profit_exit";
      }

      const pnlDollars =
        lockedProceeds + remainderPayout - entryCostDollars - entryFeeDollars - exitFeeDollars - settlementFeeDollars;
      const outcome: "win" | "loss" = pnlDollars > 0 ? "win" : "loss";

      const closeTs = new Date(closeTime).getTime();
      const openTs = new Date(openTime).getTime();
      const entryTs = new Date(entryFillTime).getTime();

      const row = {
        ticker,
        side,
        strike,
        strikeType: m.strike_type,
        openTime,
        closeTime,
        orderPlacedTime: firstOrderPlacedTime,
        entryFillTime,
        entryPriceCents: Math.round(weightedPriceCents * 100) / 100,
        entryCountContracts: totalCount,
        entryFeeDollars: Math.round(entryFeeDollars * 1e6) / 1e6,
        exitReason,
        exitedQtyLocked: Math.round((totalCount - remaining) * 100) / 100,
        remainderQty: Math.round(remaining * 100) / 100,
        lockedProceedsDollars: Math.round(lockedProceeds * 1e6) / 1e6,
        exitFeeDollars: Math.round(exitFeeDollars * 1e6) / 1e6,
        lastLockTime,
        remainderPayoutDollars: Math.round(remainderPayout * 1e6) / 1e6,
        settlementFeeDollars: Math.round(settlementFeeDollars * 1e6) / 1e6,
        minutesRemainingAtEntry: (closeTs - entryTs) / 60000,
        minutesElapsedAtEntry: (entryTs - openTs) / 60000,
        outcome,
        pnlDollars: Math.round(pnlDollars * 1e6) / 1e6,
        numEntryOrderLegs: legs.length,
      };

      if (isDual) excludedDualSided.push(row);
      else trades.push(row);
    }
  }

  trades.sort((a, b) => a.entryFillTime.localeCompare(b.entryFillTime));

  const wins = trades.filter((t) => t.outcome === "win");
  const losses = trades.filter((t) => t.outcome === "loss");
  console.log(`\nClean (single-sided) trades: ${trades.length}`);
  console.log(`Wins: ${wins.length}, Losses: ${losses.length}`);
  console.log(`Net P&L: $${trades.reduce((s, t) => s + t.pnlDollars, 0).toFixed(2)}`);
  console.log(`Excluded (dual-sided-window) trades: ${excludedDualSided.length}`);
  const byReason: Record<string, number> = {};
  for (const t of trades) byReason[t.exitReason] = (byReason[t.exitReason] ?? 0) + 1;
  console.log("By exit reason:", byReason);
  const entryPrices = trades.map((t) => t.entryPriceCents).sort((a, b) => a - b);
  console.log(
    `Entry price range: min=${entryPrices[0]}c, median=${entryPrices[Math.floor(entryPrices.length / 2)]}c, max=${entryPrices[entryPrices.length - 1]}c`
  );

  writeFileSync("scripts/btc_trades_clean.json", JSON.stringify(trades, null, 2));
  writeFileSync("scripts/btc_trades_dual_sided_excluded.json", JSON.stringify(excludedDualSided, null, 2));
  console.log("Saved scripts/btc_trades_clean.json and scripts/btc_trades_dual_sided_excluded.json");
}

main();
