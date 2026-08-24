import { signRequest } from "./kalshiAuth.ts";
import { config } from "./config.ts";

const BALANCE_PATH = "/trade-api/v2/portfolio/balance";
const ORDERS_PATH = "/trade-api/v2/portfolio/orders";
const POSITIONS_PATH = "/trade-api/v2/portfolio/positions";

// Read-only account snapshot: wallet balance plus which market tickers
// currently have a resting order or an open position. Only ever GETs —
// never places, cancels, or modifies anything.
export type PortfolioSnapshot = {
  balanceCents: number;
  restingTickers: Set<string>;
  holdingTickers: Set<string>;
};

async function getJson(path: string, query = ""): Promise<any> {
  const headers = { ...signRequest("GET", path), Accept: "application/json" };
  const res = await fetch(`${config.restBaseUrl}${path}${query}`, { headers });
  if (!res.ok) {
    throw new Error(
      `Kalshi portfolio request failed: ${path} ${res.status} ${await res.text()}`
    );
  }
  return res.json();
}

export async function fetchPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const [balanceBody, ordersBody, positionsBody] = await Promise.all([
    getJson(BALANCE_PATH),
    getJson(ORDERS_PATH, "?status=resting&limit=1000"),
    getJson(POSITIONS_PATH, "?limit=1000"),
  ]);

  const restingTickers = new Set<string>(
    (ordersBody.orders ?? []).map((o: { ticker: string }) => o.ticker)
  );

  const holdingTickers = new Set<string>(
    (positionsBody.market_positions ?? [])
      .filter((p: { position_fp: string }) => parseFloat(p.position_fp) !== 0)
      .map((p: { ticker: string }) => p.ticker)
  );

  return {
    balanceCents: balanceBody.balance as number,
    restingTickers,
    holdingTickers,
  };
}

const SETTLEMENTS_PATH = "/trade-api/v2/portfolio/settlements";

type Settlement = {
  ticker: string;
  yes_count_fp: string;
  yes_total_cost_dollars: string;
  no_count_fp: string;
  no_total_cost_dollars: string;
  fee_cost?: string;
  market_result: "yes" | "no" | "";
  settled_time: string;
};

// Realized P&L for one settled ticker, computed from the actual settlement
// outcome. Each held contract pays out $1 if its side matches
// `market_result`, $0 otherwise — this covers a position held to expiry on
// just one side (no sell before close) as well as a position that ended up
// holding both sides. A held contract that wins is a real profit, not a
// loss, regardless of whether it was ever sold before the window closed.
function realizedPnlFromSettlement(s: Settlement): number {
  const yesCount = parseFloat(s.yes_count_fp);
  const noCount = parseFloat(s.no_count_fp);
  const yesCost = parseFloat(s.yes_total_cost_dollars);
  const noCost = parseFloat(s.no_total_cost_dollars);
  const fee = parseFloat(s.fee_cost ?? "0");

  const payout =
    (s.market_result === "yes" ? yesCount : 0) + (s.market_result === "no" ? noCount : 0);

  return payout - yesCost - noCost - fee;
}

// Returns null if the ticker hasn't settled yet (Kalshi posts settlements a
// few seconds after a market closes — caller should retry shortly after).
export async function fetchTickerRealizedPnl(ticker: string): Promise<number | null> {
  const body = await getJson(SETTLEMENTS_PATH, "?limit=200");
  const settlement = (body.settlements ?? []).find((s: Settlement) => s.ticker === ticker);
  return settlement ? realizedPnlFromSettlement(settlement) : null;
}

function seriesTickerOf(ticker: string): string {
  const m = ticker.match(/^(.+?)-\d{2}[A-Z]{3}\d{2}/);
  return m ? m[1] : ticker;
}

// Session P&L is in-memory only and resets to 0 whenever this process
// restarts (including on every `tsx watch` reload). Called once at startup
// to seed each tracked market's PnlTracker from everything settled since
// `since` (normally UTC midnight, but movable — see pnlReset.ts), so a
// restart doesn't just wipe the on-screen total back to zero. Settlements
// come back newest-first, so this stops as soon as it walks past `since`
// rather than paging through the whole history.
export async function fetchTodaysRealizedPnlBySeries(since: Date): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  let cursor: string | undefined;

  paging: for (let page = 0; page < 50; page++) {
    const query = `?limit=1000${cursor ? `&cursor=${cursor}` : ""}`;
    const body = await getJson(SETTLEMENTS_PATH, query);
    const batch: Settlement[] = body.settlements ?? [];
    if (batch.length === 0) break;

    for (const s of batch) {
      if (new Date(s.settled_time) < since) break paging;
      const series = seriesTickerOf(s.ticker);
      result.set(series, (result.get(series) ?? 0) + realizedPnlFromSettlement(s));
    }

    cursor = body.cursor;
    if (!cursor) break;
  }

  return result;
}
