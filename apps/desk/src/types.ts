// The api's /portfolio reply (apps/api/src/api/portfolio.py). Numbers come as strings to keep precision.
export type Num = string | null;

export interface Holding {
  asset: string;
  source: "Binance" | "TAO wallet";
  amount: string;
  price: Num;
  value: Num;
  change24h: Num;
  share: Num;
  averageCost: Num;
  covered: Num;
  profit: Num;
  profitPercent: Num;
  costEntered?: boolean; // the owner's own average cost, not one from trades (decision 27)
  feeToken?: boolean; // BNB: the average of this year's buys, for all that's held (decision 35)
}

export interface Order {
  orderId: number;
  symbol: string;
  time: number;
  pair: string;
  side: string;
  type: string;
  price: string;
  amount: string;
  filled: string;
}

export interface Trade {
  time: number;
  pair: string;
  side: string;
  price: string;
  amount: string;
  total: string;
  fee: string;
}

export interface Portfolio {
  fetchedAt: string;
  demo?: boolean;
  total: {
    value: string;
    aud: Num;
    audRate: Num;
    rates?: Record<string, string>; // units per US dollar: USD, AUD, INR, BTC (decision 30)
    audDate: Num;
    change24h: string;
    change24hPercent: Num;
    profit: string;
    profitPercent: Num;
    cost: string;
  };
  holdings: Holding[];
  openOrders: Order[];
  recentTrades: Trade[];
  wallets: {
    binance: { status: "connected" };
    tao: TaoWallet;
  };
  history: { day: string; value: string }[];
}

export type TaoWallet =
  | { status: "connected"; free: string; staked: string; total: string; rewards?: string }
  | { status: "not_set" }
  | { status: "error"; error: string };

// The api's trade terminal replies (apps/api/src/api/trading.py).
export interface Settings {
  tradingOn: boolean;
  perOrder: string;
  perDay: string;
  spentToday: string;
  leftToday: string;
}

export type TradeStatus =
  | "placing"
  | "waiting"
  | "needs_exits"
  | "protected"
  | "open"
  | "closed_tp"
  | "closed_sl"
  | "closed_market"
  | "cancelled";

export interface SmartTrade {
  id: number;
  ref: string;
  created: number;
  pair: string;
  entry: "market" | "limit";
  entryPrice: Num;
  amount: Num;
  spend: string;
  takeProfit: Num;
  stopLoss: Num;
  status: TradeStatus;
  exitPrice: Num;
  profit: Num;
  note: Num;
}

export interface Terminal {
  demo?: boolean;
  symbol: string;
  pair: string;
  pairs: { symbol: string; pair: string }[];
  price: string;
  change24h: string;
  base: string;
  quote: string;
  quoteFree: string;
  baseFree: string;
  step: string;
  tick: string;
  minOrder: string;
  settings: Settings;
  trades: SmartTrade[];
  openOrders: Order[];
}

export interface SmartTradeRequest {
  clientId: string;
  symbol: string;
  entry: "market" | "limit";
  limitPrice?: string;
  spend: string;
  takeProfit?: string;
  stopLoss?: string;
}

// The AI desk (TODO 3): tickers, the watchlist, charts and signals (apps/api/src/api/handler.py).
export interface Ticker {
  coin: string;
  price: string;
  change24h: string;
}

export type Verdict = "Buy now" | "Wait" | "Avoid";

export interface Signal {
  coin: string;
  verdict: Verdict;
  confidence: number;
  sentiment: string;
  trend: string;
  rsi: Num;
  support: Num;
  resistance: Num;
  buyLevel: string;
  price: string;
  summary: string;
  reasons: string[];
  model: string;
  ranAt: number;
  stale: boolean;
  // The position-aware plan (decision 46); missing on a signal from before it.
  action?: PlanAction;
  confidenceBefore?: number | null;
  actionBefore?: string | null;
  horizons?: { short: PlanAction; swing: PlanAction; long: PlanAction };
  zones?: {
    buy: { low: string; high: string } | null;
    noChase: string | null;
    invalidation: { price: string; next: string | null } | null;
    trim: { low: string; high: string } | null;
  };
  why?: { bull: string; bear: string; changeMind: string };
  watchFor?: { price: string; direction: "above" | "below"; note: string }[];
  changedSince?: string;
  context?: string[];
  rulesNotes?: string[];
}

export type PlanAction = "Buy" | "Add" | "Hold" | "Trim" | "Sell" | "Wait";

export interface RiskRules {
  maxCoinPct: string;
  tradeBudgetAud: string;
  maxLossPct: string;
}

export interface PriceAlert {
  id: number;
  coin: string;
  direction: "above" | "below";
  price: string;
  note: string;
  created: number;
  triggered: number | null;
}

// The live half of the AI panel: everything worked out in code (decision 46).
export interface PlanFacts {
  coin: string;
  pair: string;
  quote: string;
  price: string;
  position: {
    held: boolean;
    qty: string;
    avgCost: Num;
    invested: Num;
    value: Num;
    pnl: Num;
    pnlPct: Num;
    weightPct: Num;
  };
  cash: Num;
  total: Num;
  audPerUsd: string;
  rules: RiskRules;
  whatIf: {
    amount: Num;
    price: string;
    newAvg: Num;
    breakEvenBefore: Num;
    breakEvenAfter: Num;
    weightBefore: Num;
    weightAfter: Num;
    cashLeft: Num;
  };
  checks: { canAdd: boolean; pastMaxLoss: boolean; notes: string[] };
  levels: { id: string; price: string; source: string; awayPct: Num }[];
  track: { scored: number; correct: number; hours: number };
  alerts: PriceAlert[];
}

export interface WatchedCoin {
  coin: string;
  symbol: string;
  pair: string;
  price: Num;
  change24h: Num;
  signal: Signal | null;
}

export interface ListSummary {
  id: number;
  name: string;
  count: number;
}

export interface Watchlist {
  lists: ListSummary[];
  list: { id: number; name: string };
  coins: WatchedCoin[];
  max: number;
  aiBudget: { spent: string; cap: string };
}

export type Interval = "15m" | "1h" | "4h" | "1d";

export interface Candle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

export interface Market {
  symbol: string;
  coin: string;
  pair: string;
  quote: string;
  interval: Interval;
  price: string;
  change24h: string;
  high24h: Num;
  low24h: Num;
  volume24h: Num;
  candles: Candle[];
  indicators: {
    rsi: Num;
    sma20: Num;
    sma50: Num;
    support: Num;
    resistance: Num;
    trend: string;
  };
  // Month, week and day opens and the previous day's and week's highs and lows (decision 28).
  levels?: { name: string; price: string }[];
}

export interface OrderRequest {
  clientId: string;
  symbol: string;
  side: "buy" | "sell";
  price: string;
  amount: string;
  takeProfit?: string;
  stopLoss?: string;
}

// Ladder buys (decision 39): limit buys from top to bottom, each a smart trade.
export interface LadderRequest {
  clientId: string;
  symbol: string;
  top: string;
  bottom: string;
  count: string;
  spend: string;
  weighting: "equal" | "lower";
  takeProfit?: string;
  stopLoss?: string;
}

// The api's /deposits reply (apps/api/src/api/deposits.py, decision 31).
export interface FyDeposits {
  fy: string;
  from: string;
  to: string;
  coin: string;
  total: { usdc: string; aud: string; audPerUsdc: Num; paid: number; estimated: number };
  months: { month: string; label: string; usdc: string; aud: string; count: number }[];
  deposits: {
    time: number;
    day: string;
    amount: string;
    network: string;
    aud: Num;
    basis: "paid" | "estimate" | "unknown";
    rate: Num;
  }[];
}

// The api's /sentiment reply: the Crypto Fear & Greed Index (decision 36).
export interface Sentiment {
  value: number;
  label: string;
  yesterday: number | null;
  updated: number;
}

// The whole market for the header (decision 44): empty if CoinGecko can't say.
export interface MarketGlobal {
  cap?: string;
  capChange?: string;
  volume?: string;
  btcShare?: string;
  ethShare?: string;
}

// The Fear & Greed details (decision 42).
export interface FgDay {
  value: number;
  label: string;
  day: number;
}
export interface SentimentDetail {
  now: FgDay;
  history: Partial<Record<"yesterday" | "lastWeek" | "lastMonth" | "lastYear", FgDay>>;
  high: FgDay;
  low: FgDay;
  summary: string;
  chart: { day: number; value: number }[];
  market: { cap: string; capChange: string; volume: string; btcShare: string } | null;
}

// DCA bots (decision 37): the api's /bots and /bots/preview replies.
export type Timeframe = "15m" | "1h" | "4h";

export interface DcaConfig {
  timeframe: Timeframe;
  bbLength: number;
  bbDeviation: string;
  baseOrder: string;
  dcaOrder: string;
  deviation: string;
  maxDcaOrders: number;
  sizeMultiplier: string;
  deviationMultiplier: string;
  takeProfit: string;
  maxDeals: number;
  entryPrice?: string | null;
  takeProfitOn?: boolean;
  stopLoss?: string | null;
}

export interface DcaDeal {
  id: number;
  ref: string;
  started: number;
  spent: string;
  held: string;
  average: Num;
  takeProfit: Num;
  filled: number;
  baseFilled: boolean;
  of: number;
  nextPrice: Num;
  nextSpend: Num;
  unrealised: Num;
  unrealisedPercent: Num;
}

export interface DcaBot {
  id: number;
  ref: string;
  name: string;
  symbol: string;
  pair: string;
  enabled: boolean;
  status: "off" | "waiting" | "deal" | "finishing" | "paused";
  note: string | null;
  config: DcaConfig;
  budget: string;
  maxBudget: string;
  covers: string;
  price: Num;
  lower: Num;
  deals: DcaDeal[];
  closed: number;
  profit: string;
}

export interface DcaBots {
  quote: string;
  tradingOn: boolean;
  bots: DcaBot[];
}

export interface LadderRow {
  rung: number;
  drop: string;
  price: string;
  qty: string;
  spend: string;
  total: string;
  average: string;
  takeProfit: string;
}

export interface Backtest {
  from: number | null;
  to: number | null;
  candles: number;
  deals: number;
  expired: number;
  profit: string;
  profitPercent: string;
  mostDcaFilled: number;
  mostSpent: string;
  worstDrawdown: string;
  averageHours: Num;
  openDeal: boolean;
  unrealised: string;
}

export interface DcaPreview {
  symbol: string;
  pair: string;
  quote: string;
  price: string;
  band: { lower: string; middle: string; upper: string };
  met: boolean;
  ladder: LadderRow[];
  budget: string;
  covers: string;
  available: string;
  settings: Settings;
  problems: string[];
  chart: { t: number; o: string; h: string; l: string; c: string; lower: Num; upper: Num }[];
  backtest: Backtest;
}

// A preset for a coin, from its last 30 days, with a reason for each setting.
export interface DcaSuggestion {
  symbol: string;
  config: DcaConfig;
  reasons: Record<string, string>;
  backtest: Backtest;
}

export interface BotOrder {
  ref: string;
  kind: string;
  side: string;
  price: string;
  qty: string;
  spend: string;
  status: string;
  filled: string;
  time: number;
}

export interface DealDetail extends Partial<DcaDeal> {
  id: number;
  ref: string;
  status: "open" | "closed" | "expired" | "stopped";
  started: number;
  ended: number | null;
  profit: Num;
  note: string | null;
  orders: BotOrder[];
}

export interface DcaDetail {
  bot: DcaBot;
  deals: DealDetail[];
}

export type DcaRequest = DcaConfig & { symbol: string };

// Grid bots (decision 38): the api's /grids and /grids/preview replies.
export interface GridConfig {
  lower: string;
  upper: string;
  grids: number;
  spacing: "arithmetic" | "geometric";
  investment: string;
  buyFirst: boolean;
  stopBelow: string | null;
  perOrder: string;
  profitPerGrid: [string, string];
}

export interface GridBot {
  id: number;
  ref: string;
  name: string;
  symbol: string;
  pair: string;
  enabled: boolean;
  status: "off" | "running" | "finishing" | "paused";
  note: string | null;
  config: GridConfig;
  started: number | null;
  price: Num;
  inRange: boolean;
  openBuys: number;
  openSells: number;
  trips: number;
  gridProfit: string;
  held: string;
  unrealised: Num;
}

export interface GridBots {
  quote: string;
  tradingOn: boolean;
  grids: GridBot[];
}

export interface GridBacktest {
  from: number;
  to: number;
  candles: number;
  trips: number;
  gridProfit: string;
  unrealised: string;
  totalPercent: string;
  holdPercent: string;
  inRange: string;
}

export interface GridPreview {
  symbol: string;
  pair: string;
  quote: string;
  price: string;
  config: GridConfig;
  suggested: { lower: string; upper: string };
  inRange: boolean;
  lines: { price: string; side: "buy" | "sell" | "none" }[];
  opening: { buys: number; buyFirst: number; buyFirstSpend: string; spend: string };
  available: string;
  settings: Settings;
  problems: string[];
  chart: { t: number; o: string; h: string; l: string; c: string }[];
  backtest: GridBacktest;
}

export interface GridSuggestion {
  symbol: string;
  config: GridConfig;
  reasons: Record<string, string>;
  backtest: GridBacktest;
}

export interface GridOrder {
  ref: string;
  side: string;
  line: number;
  price: string;
  qty: string;
  status: string;
  filled: string;
  profit: Num;
  time: number;
}

export interface GridDetail {
  grid: GridBot;
  orders: GridOrder[];
}

export interface GridRequest {
  symbol: string;
  lower: string;
  upper: string;
  grids: string;
  spacing: "arithmetic" | "geometric";
  investment: string;
  buyFirst: boolean;
  stopBelow: string;
}
