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
  /** How it reached Claude: "API key" or "Claude subscription" (decision 48). */
  via?: string;
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
  profileVersion?: number | null;
  outOfDate?: boolean;
}

export type PlanAction = "Buy" | "Add" | "Hold" | "Trim" | "Sell" | "Wait";

// The trading agent (TODO 6): its versioned profile, and a run of Analyse on one coin.
export type AgentStepKey = "macro" | "technical" | "planfit" | "debate" | "risk" | "decision";
export type AgentStyle = "careful" | "balanced" | "opportunistic";
export type AgentFocus = "dca" | "swing" | "both";
export type AgentAutonomy = "advise" | "propose";

export interface AgentDoc {
  name: string;
  title: string;
  style: AgentStyle;
  focus: AgentFocus;
  brief: string;
  always: string[];
  never: string[];
  confidenceFloor: number;
  autonomy: AgentAutonomy;
  steps: Record<AgentStepKey, { on: boolean; model: string }>;
}

export interface AgentPage {
  version: number; // 0 until the first save: the defaults
  time: number | null;
  agent: AgentDoc;
  history: { n: number; time: number; author: string; summary: string }[]; // newest first
  told: string;
  estimate: string; // US$ a run
  models: { id: string; name: string }[];
  steps: { key: AgentStepKey; title: string; who: string; fixed: boolean }[];
}

// One of the owner's Markdown files (decision 61), exactly as written. `error` is set when the
// latest edit didn't parse; the last good version stays in force.
export interface MarkdownFile {
  markdown: string;
  version: number;
  time: number | null;
  error: string | null;
}

// My agents (TODO 10): a file's header and schedule. `day` 0 is Monday; `minute` is from
// midnight, Sydney time. An item with no day is a trigger ("When the USDC lands").
export interface MyAgentSlot {
  day: number | null;
  minute: number | null;
  label: string;
}

// A job the scheduler runs for an agent (api.schedule).
export interface AgentJob {
  key: string;
  agent: string;
  label: string;
  when: string;
  next: number;
  last: { at: number; status: "ok" | "failed" | "running"; line: string } | null;
}

export interface MyAgent {
  slug: string;
  file: string;
  purpose: string;
  about: string;
  model: { id: string; name: string; effort: string };
  autonomy: string;
  cost: string;
  icon: string;
  persona: { title: string; traits: string };
  sends: string;
  coins: string[];
  schedule: MyAgentSlot[];
  next: { at: number; label: string } | null;
  version: number;
  time: number;
  running: boolean;
  jobs?: AgentJob[];
}

export interface MyAgentsPage {
  agents: MyAgent[];
  folder: string;
  scheduleOn?: boolean;
}

export interface RunStep {
  key: "brief" | AgentStepKey;
  title: string;
  who: string;
  model: string | null;
  status: "pending" | "done" | "skipped" | "failed";
  summary: string;
  points: string[];
  events: { when: string; what: string }[];
  cost: string;
  note: string | null;
}

export interface AgentTicket {
  side: "buy" | "sell";
  price: string;
  qty: string;
  totalUsd: string;
  totalAud: string;
  breaks: RuleBreak[]; // empty: within the Profile
}

export type TicketChoice = "used" | "edited" | "dismissed";

export interface AgentRun {
  id: number;
  coin: string;
  started: number;
  finished: number | null;
  status: "running" | "done" | "stopped";
  agentVersion: number;
  profileVersion: number;
  cost: string;
  agent: { name: string; title: string; autonomy: string };
  price: string;
  change24h: string;
  position: {
    held: boolean;
    qty: string;
    avgCost: Num;
    value: string;
    pnlPct: Num;
    weightPct: Num;
  };
  cashUsd: string;
  levels: { id: string; price: string; source: string; awayPct: Num }[];
  guardrails: {
    capAud: Num;
    monthSpentAud: string;
    maxPctPerCoin: Num;
    sharePct: Num;
    perTradeAud: Num;
    minCashAud: Num;
    audPerUsd: string;
  };
  steps: RunStep[];
  signal: Signal | null;
  ticket: AgentTicket | null;
  noTicket: string | null;
  choice: TicketChoice | null;
  asks: { q: string; a: string }[];
  outOfDate: boolean;
  busy?: boolean; // another request holds the step: nothing was run
}

export interface AgentCall {
  coin: string;
  action: string;
  confidence: number;
  ranAt: number;
  outOfDate: boolean;
}

// A price alert on a coin (decision 46): sent to Telegram when the price crosses it.
export interface PriceAlert {
  id: number;
  coin: string;
  direction: "above" | "below";
  price: string;
  note: string;
  created: number;
  triggered: number | null;
}

export interface CoinRank {
  coin: string;
  priority: "high" | "medium" | "low";
  reason: string;
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
  override?: boolean;
}

// Ladder buys (decision 39): limit buys from top to bottom, each a smart trade.
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
    basis: "paid" | "chunk" | "estimate" | "unknown";
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

// The Settings page's AI section (decision 50): the choice and whether each credential is set.
export type AiMode = "api_key" | "subscription";
export interface AiSettings {
  mode: AiMode;
  fallback: boolean;
  apiKeySet: boolean;
  tokenSet: boolean;
  model: string;
  models: { id: string; name: string }[];
  budget: { spent: string; cap: string };
}

// The coach Dashboard (decision 52): every figure worked out by the api; the words kept per day.
export type Mood = "sharp_up" | "up" | "flat" | "down" | "sharp_down";
export type KeyPoint =
  | { kind: "concentration"; coin: string; pct: string; cap: string; rule: true }
  | { kind: "loss"; coin: string; pct: string; cap: string; rule: true }
  | { kind: "mover"; coin: string; pct: string; rule: false }
  | { kind: "addZone"; coin: string; low: string; high: string; rule: false }
  | { kind: "nearInvalidation"; coin: string; pct: string; price: string; rule: false };
// The Dashboard's week rail (decision 63): Monday to Sunday with the plan's buys on their days.
export type BuyState = "upcoming" | "due" | "done" | "missed" | "unknown";
export interface CoachWeek {
  today: string;
  days: { date: string; name: string; kind: "" | "buy" | "extra" }[];
  buy: {
    date: string;
    aud: string;
    boughtAud: string | null;
    state: BuyState;
    // With a DCA book plan (decision 72): the weekly buy in the quote, and what's bought of it.
    usdc?: string;
    boughtUsdc?: string;
    quote?: string;
    coins?: string[];
  } | null;
  extra: { date: string; aud: string; fearGreedBelow: number | null; state: BuyState } | null;
  boughtAud: string | null;
  maxWeekAud: string | null;
  maxMonthAud: string | null;
}
export interface Coach {
  greeting: string;
  mood: Mood;
  moodLabel: string;
  changePct: string;
  changeAud: string;
  streak: { weekPct: string; everyDay: string } | null;
  takeProfit: string | null;
  withinRules: boolean;
  deposits: {
    known: boolean;
    fy: string | null;
    fyAud: string;
    monthAud: string;
    capAud: string | null;
    leftAud: string | null;
    overAud: string | null;
    usedPct: string | null;
    resetsOn?: string; // the 1st of next month, when the cap starts again
    daysLeft?: number;
    lesson: ProfileLesson | null;
  };
  keyPoints: KeyPoint[];
  day: string;
  week?: CoachWeek | null; // decision 63: null before profile.md is v2
  message: {
    lines: string[];
    coach: string;
    link: "trade" | null;
    source: "plain" | "model";
    outOfDate?: boolean;
  };
  pending: boolean;
}

// The Profile (decision 58): the owner's Investment Policy Statement, every agent's source.
// Field names are the api's own, so the document goes back and forth unchanged.
export interface ProfileGoal {
  label: string | null;
  amount: string;
  currency: "AUD" | "USD" | null;
  date: string | null;
  then_rule: string | null;
}
export interface ProfileHolding {
  name: string;
  source: "binance" | "taostats" | "manual" | null;
  invested_aud: Num;
  value_aud: Num;
  cash: boolean;
  counts: boolean;
}
export interface ProfileLesson {
  year: string | null;
  text: string;
}
export interface ProfileRules {
  monthly_deposit_cap_aud: Num;
  deposit_cadence: "weekly" | "fortnightly" | "monthly" | null;
  max_pct_per_coin: Num;
  per_trade_aud: Num;
  max_loss_pct: Num;
  rebalance_band: Num;
  take_profit_rule: string | null;
  entry_strategy: string | null;
  behaviour_rules: string[];
}
export interface ProfileDoc {
  identity: { name: string | null; date_of_birth: string | null };
  income: {
    gross_monthly_aud: Num;
    after_tax_monthly_aud: Num;
    living_monthly_aud: Num;
    available_monthly_aud: Num;
    notes: string | null;
  };
  goals: ProfileGoal[];
  foundations: {
    emergency_fund_aud: Num;
    emergency_months: Num;
    parked_funds_aud: Num;
    min_cash_aud: Num;
    insurance: string[];
    health_cover_status: "none" | "parked" | "active" | null;
    health_cover_monthly_aud: Num;
    debt: string | null;
    wills: string | null;
  };
  strategy: { text: string | null; focus: string | null; targets: { coin: string; pct: string }[] };
  rules: ProfileRules;
  holdings: ProfileHolding[];
  lessons: ProfileLesson[];
  additional_info: string;
  markdown: string;
  locks: { goals: boolean; min_cash: boolean; deposit_cap: boolean };
}
export type ProfileSection = Exclude<keyof ProfileDoc, "locks">;
export type CheckStatus = "ok" | "attention" | "broken" | "unset";
export interface ProfileChange {
  section: string;
  key: string;
  label: string;
  from: string;
  to: string;
}
export interface ProfileSuggestion {
  id: string;
  time: number;
  author: string;
  baseVersion: number;
  sections?: Partial<ProfileDoc>;
  markdown?: string;
  diff?: DiffLine[];
  changes: ProfileChange[];
  summary: string;
  reason: string;
  conflicts: string[];
  blocked: string | null;
}
export interface Dated {
  profileVersion: number | null;
  outOfDate: boolean;
}
export interface PlannerReview extends Dated {
  time: number;
  summary: string;
  gaps: string[];
  suggestionId: string | null;
}
export interface Recap extends Dated {
  week: string;
  time: number;
  source: "plain" | "model";
  headline: string;
  lines: string[];
}
export interface LiveHolding extends ProfileHolding {
  now_aud: Num;
  pnl_aud: Num;
  pnl_pct: Num;
}
export interface ProfileStrip {
  totalAud: string;
  totalUsd: string;
  nextGoal: (ProfileGoal & { pct: string; have: string }) | null;
  cash: { now: Num; floor: Num; pct: Num; status: CheckStatus };
  month: { spent: string; cap: Num; pct: Num; status: CheckStatus };
}
export type FoundationStatus = "done" | "parked" | "below" | "unset";
export interface ProfilePage {
  version: number;
  time: number | null;
  profile: ProfileDoc;
  updated: Record<ProfileSection, number | null>;
  live: {
    known: boolean;
    strip: ProfileStrip;
    holdings: LiveHolding[];
    checks: Partial<Record<keyof ProfileRules, { status: CheckStatus; text: string }>>;
    foundations: Record<string, FoundationStatus>;
  };
  board: ProfileBoard | null;
  suggestions: ProfileSuggestion[];
  planner: PlannerReview | null;
  recap: Recap | null;
}

// profile.md v2's four widgets (decision 62), worked out by the api. Money is whole A$ or US$.
export interface DiffLine {
  kind: "same" | "del" | "add" | "gap";
  text: string;
}
export interface BoardTick {
  usd?: string;
  aud?: string;
  year?: number;
  state: "passed" | "next" | "";
}
export interface BoardSummary {
  name: string | null;
  age: number | null;
  subline: string;
  risk: string | null;
  goalPct: Num;
  dca: {
    weeklyAud: Num;
    day: string | null;
    extraAud: Num;
    fearGreedBelow: number | null;
    maxMonthAud: Num;
  };
  split: string[];
  splitLabel: string | null;
  cash: { totalAud: Num; floorAud: Num; below: boolean };
  chips: string[];
  openItems: string[];
  lesson: { title: string; story: string; lesson: string } | null;
}
export interface BoardRoad {
  known: boolean;
  goalUsd: string;
  goalDate: string;
  ticks: BoardTick[];
  then: { usd: string; year: number } | null;
  totalUsd?: string;
  totalAud?: string;
  parts?: { taoAud: string; binanceAud: string; emergencyAud: string };
  pct?: Num;
  onTrack?: boolean;
  pathUsd?: Num;
  leg?: {
    fromUsd: string;
    toUsd: string;
    year: number;
    pct: Num;
    toGoUsd: string;
    monthsLeft: number;
  } | null;
  thenPct?: Num;
  path: { date: string; usd: string }[];
  today: string;
}
export interface BoardStack {
  known: boolean;
  target: string;
  weeklyAud: Num;
  day: string | null;
  bought: boolean | null;
  ticks: string[];
  held?: string;
  pct?: Num;
  valueAud?: Num;
  priceAud?: Num;
  next?: Num;
  leg?: { from: string; to: string; pct: Num; toGo: string; weeksLeft: number | null } | null;
  projected?: string | null;
}
export interface BoardCash {
  totalAud: string;
  floorAud: string;
  pct: Num;
  parkedAud: string;
  emergencyAud: string;
  parkedPct: Num;
  emergencyPct: Num;
  monthlyAud: Num;
  shortAud: string;
  full: boolean;
  ticks: BoardTick[];
  projected: string | null;
  emergency: { targetAud: Num; pct: Num; toGoAud: Num; months: number } | null;
}
export interface ProfileBoard {
  summary: BoardSummary;
  road: BoardRoad | null;
  stack: BoardStack | null;
  cash: BoardCash | null;
  fx: { audPerUsd: Num; date: string | null };
}
export interface ProfileVersionDetail extends ProfileVersion {
  markdown: string;
  diff: DiffLine[];
}
export type CommandReply =
  | { kind: "answer"; answer: string; question: string; profileVersion: number }
  | { kind: "change"; suggestion: ProfileSuggestion };
export interface ProfileVersion {
  n: number;
  time: number;
  author: string;
  summary: string;
  reason: string;
}
export interface RuleBreak {
  rule: string;
  label: string;
  message: string;
}

// The agents (decision 59): a team of five under the Desk Coordinator.
export interface AgentInfo {
  id: string;
  name: string;
  title: string;
  remit: string;
  reportsTo: string | null;
}

export interface AgentMessage {
  role: "owner" | "agent";
  text: string;
  time: number;
}
export interface AgentThread {
  id: string;
  name: string;
  title: string;
  messages: AgentMessage[];
}

// Tax lots and the 12-month countdown (decision 54).
export interface TaxLot {
  coin: string;
  bought: string | null;
  qty: string;
  costAud: string | null;
  nowAud: string | null;
  gainAud: string | null;
  heldDays: number | null;
  qualifiesOn: string | null;
  daysToDiscount: number | null;
}
export interface TaxReport {
  fy: string;
  realisedGainsAud: string;
  realisedLossesAud: string;
  sales: number;
  unknownSales: number;
  discountedAud: string;
  next: TaxLot | null;
  lots: TaxLot[];
  underWater: { coin: string; lossAud: string; afterAud: string }[];
}
export interface SellCheck {
  coin: string;
  qty: string;
  lots: TaxLot[];
  young: boolean;
  youngest: TaxLot | null;
  gainAud: string | null;
  unknown: boolean;
}

// Drift from the Profile's target allocation (decision 55).
export interface DriftRow {
  coin: string;
  targetPct: string;
  nowPct: string;
  outside: boolean;
  side: "buy" | "sell" | null;
  toTargetAud?: string;
  orderAud?: string;
  price?: string | null;
  qty?: string | null;
  capped?: boolean;
}
export interface Drift {
  band: string;
  rows: DriftRow[];
  outside: number;
  hasTargets: boolean;
}

// The Journal (decision 56).
export interface JournalEntry {
  key: string;
  time: number;
  coin: string;
  side: "buy" | "sell";
  qty: string;
  price: string;
  aud: string;
  from: string;
  resultAud: string | null;
  broke: string[];
  setups: string[];
  mistakes: string[];
}
export interface JournalData {
  entries: JournalEntry[];
  score: {
    days: number;
    trades: number;
    kept: number;
    keptPct: string | null;
    mostBroken: { what: string; times: number }[];
    withMistakeAud: string;
    withoutMistakeAud: string;
  };
  lists: { setups: string[]; mistakes: string[] };
}

// Telegram's morning summary (decision 57).
export interface TelegramSettings {
  tokenSet: boolean;
  chatFound: boolean;
  chatName: string | null;
  linkCode: string | null;
  time: string;
  lastSent: string | null;
}

// The DCA book (TODO 11): five lifelong positions fed only by orders placed from the desk.
export type DcaSource =
  "weekly" | "named" | "close-out" | "trim" | "buy-back" | "desk" | "imported";
export interface DcaPlan {
  start: string;
  weeks: number;
  orders: { coin: string; spend: string; odds: number }[];
}
export interface DcaOrder {
  ref: string;
  coin: string;
  side: "buy" | "sell";
  kind: "limit" | "market";
  source: DcaSource;
  link: string | null;
  week: string;
  price: string | null;
  qty: string | null;
  spend: string | null;
  status: "placing" | "open" | "filled" | "cancelled";
  filledQty: string;
  filledQuote: string;
  avgPrice: string | null;
  fee: string;
  created: number;
  updated: number;
}
export interface DcaPosition {
  coin: string;
  id: string;
  since: number | null;
  qty: string;
  avgCost: string | null;
  avgCostAud: string | null;
  added: string;
  price: string | null;
  value: string | null;
  pnl: string | null;
  pnlPct: string | null;
  realised: string;
  fees: string;
}
export interface DcaTick {
  week: number;
  key: string;
  friday: string;
  state: "bought" | "missed" | "now";
  trim: boolean;
  usdc: string;
}
export interface DcaBook {
  quote: string;
  rate: string;
  plan: DcaPlan | null;
  positions: DcaPosition[];
  totals: {
    added: string;
    value: string | null;
    pnl: string | null;
    pnlPct: string | null;
    realised: string;
    fees: string;
  };
  progress: {
    week: number;
    weeks: number;
    weekly: string;
    onPlan: string;
    planTotal: string;
    ticks: DcaTick[];
  } | null;
  week: { key: string; start: number; closeOut: number; orders: DcaOrder[] };
  next: { key: string; start: number; closeOut: number };
  orders: DcaOrder[];
  priceError: string | null;
}
export interface DcaOdds {
  hit: number;
  weeks: number;
  pct: number | null;
  few: boolean;
}
export interface DcaWeekPlan {
  week: string;
  closeOut: number;
  quote: string;
  orders: {
    coin: string;
    spend: string;
    price: string;
    now: string;
    target: number;
    odds: DcaOdds;
  }[];
}
export interface DcaOrderRequest {
  coin: string;
  side?: "buy" | "sell";
  kind?: "limit" | "market";
  price?: string;
  spend?: string;
  qty?: string;
  source: DcaSource;
  link?: string;
  override?: boolean;
}

// Add or Remove funds on the DCA book (TODO 11): dca-agent's split, checked by the desk.
export interface FundsOrder {
  coin: string;
  pct: string;
  usdc: string;
  price: string;
  now: string;
  qty: string;
  odds: { hit: number; windows: number; pct: number | null };
  reason: string;
}
export interface FundsPlan {
  side: "buy" | "sell";
  amount: string;
  quote: string;
  orders: FundsOrder[];
  note: string;
  said: string[];
  // Every plan coin not in the orders, at the desk's price, with why: a share brings it back.
  skipped: FundsOrder[];
  by: "dca-agent" | "desk";
  reply?: string;
}

// Check against Binance: every order tagged DCA- on Binance, against the book.
export interface DcaCheck {
  onBinance: number;
  inBook: number;
  matched: number;
  differ: {
    ref: string;
    coin: string;
    book: { status: string; filledQty: string };
    binance: { status: string; filledQty: string };
  }[];
  onlyBook: DcaOrder[];
  onlyBinance: { ref: string; coin: string; side: string; status: string; filledQty: string }[];
  at: number;
  fixed?: number;
  added?: number;
}

// A change dca-agent proposes to an open order, checked by the desk.
export interface OpenChange {
  ref: string;
  coin: string;
  side: "buy" | "sell";
  was: string;
  price: string;
  usdc: string;
  now: string;
  odds: { hit: number; windows: number; pct: number | null };
  reason: string;
}

// One action dca-agent proposes in the book's chat, already checked by the desk.
export interface DcaAction {
  type: "buy" | "sell" | "change" | "cancel";
  coin: string;
  ref: string;
  side: "buy" | "sell";
  was: string | null;
  price: string;
  usdc: string;
  now?: string;
  odds?: { hit: number; windows: number; pct: number | null };
  reason: string;
}

// The trading pot (docs/plan-trade.md): its own book, run by trading-agent.
export interface PotOrder {
  ref: string;
  role: "entry" | "exit" | "close";
  kind: "limit" | "oco" | "market";
  price: string | null;
  stop: string | null;
  qty: string;
  status: "placing" | "open" | "filled" | "cancelled";
  created: number;
}

export interface PotTrade {
  ref: string;
  coin: string;
  setup: string;
  regime: string;
  reason: string;
  status: "placing" | "waiting" | "open" | "closed" | "cancelled";
  entry: string;
  stop: string;
  target: string;
  qty: string;
  spend: string;
  risk: string;
  fillPrice: string | null;
  now: string | null;
  exitPrice: string | null;
  exitKind: "target" | "stop" | "market" | null;
  result: string | null;
  r: string | null;
  fees: string;
  rulesKept: boolean;
  created: number;
  filled: number | null;
  closed: number | null;
  note: string | null;
  orders: PotOrder[];
}

export interface PotProposal {
  id: string;
  created: number;
  coin: string;
  setup: string;
  reason: string;
  entry: string;
  stop: string;
  target: string;
  qty: string;
  spend: string;
  risk: string;
  stopPct: string;
  rr: string;
  crowding: string;
}

// The Trading account's coin snapshot (GET /pot/coins): each coin held on Binance.
export interface AccountCoin {
  coin: string;
  amount: string;
  price: string;
  value: string;
  change24hPct: string;
  change30dPct: string | null;
  spark: string[];
  insight: { trend: string; setup: string; status: "watch" | "wait" | "none" } | null;
  tradable: boolean;
  watching: boolean;
  inTrade: boolean;
}

// risk-agent's board (GET /risk-board): every limit from the desk's figures.
// The four big risks (decision 79): each a board row with a rank and the page's detail.
export interface RiskExchange {
  totalAud: string;
  capAud: string;
  dcaAud: string;
  stablesAud: string;
  otherAud: string;
  moveAud: string;
  moves: { coin: string; aud: string; qty: string; leaves: string }[];
  afterAud: string;
}
export interface RiskCold {
  setUp: boolean;
  sharePct: string;
  coins: { coin: string; ledgerAud: string; binanceAud: string; pct: string }[];
}
export interface RiskTao {
  valueAud: string;
  costAud: string | null;
  pnlAud: string | null;
  cryptoAud: string;
  otherAud: string;
  weeklyAud: string;
  targetPct: string;
  by: string;
  weeks: number;
  reach: number | null;
  onTrack: boolean;
  thesisAt: number | null;
  thesisDue: boolean;
}
export interface RiskBackup {
  items: {
    key: string;
    label: string;
    at: number | null;
    due: number | null;
    state: "ok" | "due" | "no";
  }[];
}

export interface RiskLimit {
  key: string;
  area: "Trading pot" | "DCA book" | "Deposits" | "Portfolio" | "Big";
  rank?: number;
  short?: string;
  detail?: RiskExchange | RiskCold | RiskTao | RiskBackup;
  name: string;
  value: string;
  warn: string | null;
  limit: string | null;
  figure: string;
  of: string;
  rule: string;
  owner: string;
  state: "kept" | "near" | "broken";
  words: string;
}

export interface RiskBoard {
  sentence: string;
  limits: RiskLimit[];
  missing: string[];
  review: {
    at: number;
    headline: string;
    sections: { title: string; text: string }[];
    action: string;
  } | null;
  checkedAt: number;
  jobs: AgentJob[];
  scheduleOn: boolean;
}

// trading-agent's read of one coin for New trade (POST /pot/analyse).
export interface PotAnalysis {
  coin: string;
  verdict: "take" | "wait" | "pass";
  headline: string;
  points: string[];
  watch: string;
  plan: {
    setup: string;
    entry: string;
    stop: string;
    target: string;
    why: string;
    wrongIf: string;
  } | null;
  regime: { state: string | null; words: string };
}

// A trade typed by hand, sized by the api as it's typed (POST /pot/preview).
export interface PotPreview {
  coin: string;
  ref: string;
  now: string | null;
  tick: string;
  trade: {
    coin: string;
    entry: string;
    stop: string;
    target: string;
    qty: string;
    spend: string;
    risk: string;
    stopPct: string;
    rr: string;
    reward: string;
    targetPct: string;
    riskOfPot: string;
    allowed: string;
    fees: string;
    breakeven: string;
  } | null;
  problems: string[];
}

export interface PotView {
  quote: string;
  config: { mode: "test" | "risk"; fixed: string; riskPct: string; maxRisk?: string };
  allowedRisk?: string;
  // Free USDC on Binance against the account's available money (one wallet).
  backing?: { free: string; held: string; short: string } | null;
  putIn: string;
  value: string;
  result: string;
  resultPct: string | null;
  cash: string;
  openRisk: string;
  fees: string;
  monthResult: string;
  monthLimit: string;
  regime: { state: "bull" | "neutral" | "bear" | null; words: string };
  nextScan: number;
  lastScan: { at: number; line: string } | null;
  scansOnItsOwn?: boolean;
  proposals: PotProposal[];
  trades: PotTrade[];
  moves: { ref: string; kind: "in" | "out"; usdc: string; created: number }[];
  stats: {
    trades: number;
    wins: number;
    losses: number;
    winRate: string | null;
    avgWinR: string | null;
    avgLossR: string | null;
    expectancyR: string | null;
    drawdownPct: string;
    judgeAfter: number;
  };
  coins: string[];
  priceError: string | null;
}

export interface PotAction {
  type: "open" | "stop" | "close" | "cancel";
  ref: string | null;
  coin: string | null;
  setup: string | null;
  entry: string | null;
  stop: string | null;
  target: string | null;
  qty: string | null;
  spend: string | null;
  risk: string | null;
  rr: string | null;
  reason: string;
}

export interface PotCheck {
  matched: number;
  missing: string[];
  unknown: string[];
  differ: { ref: string; desk: string; binance: string }[];
}

export interface PotTradeRequest {
  coin: string;
  entry: string;
  stop: string;
  target: string;
  setup: string;
  reason: string;
  proposal?: string;
  override?: boolean; // past a broken Profile rule, logged (decision 78)
  style?: PotStyleKey; // sized at the style's risk (local/guides/trading-styles.md)
  expires?: number; // a style's proposal is refused after this (ms)
}

// New trade by style: the styles, the screener's shortlist, and trading-agent's picks.
export type PotStyleKey = "scalp" | "day" | "swing" | "position";
export type PotRegime = { state: "bull" | "neutral" | "bear" | null; words: string };
export interface PotStyle {
  key: PotStyleKey;
  name: string;
  line: string;
  hold: string;
  riskPct: string;
  minRr: string;
  expirySeconds: number;
  allowed: boolean;
  note: string;
}
export interface PotStyles {
  regime: PotRegime;
  styles: PotStyle[];
}
export interface PotScreenCounts {
  listed: number;
  onBinance: number;
  liquid: number;
  setups: number;
}
export interface PotScreen {
  style: PotStyleKey;
  name: string;
  regime: PotRegime;
  allowed: boolean;
  note: string;
  riskPct: string;
  warnings: string[];
  counts: PotScreenCounts;
  shortlist: { coin: string; setup: string; score: number }[];
  expires: number;
  quote?: string;
  source?: string;
}
export interface PotPick {
  coin: string;
  setup: string;
  grade: "A" | "B" | "C";
  score: number;
  verdict: "take" | "wait" | "pass";
  confluence: string[];
  against: string[];
  catalyst: string;
  crowding: string;
  reason: string;
  problem: string | null;
  entry: string;
  stop: string;
  target: string;
  qty?: string;
  spend?: string;
  risk?: string;
  rr?: string;
  stopPct?: string;
}
export interface PotJudge {
  style: PotStyleKey;
  name: string;
  regime: PotRegime;
  allowed: boolean;
  note: string;
  riskPct: string;
  warnings: string[];
  counts: PotScreenCounts;
  line: string;
  picks: PotPick[];
  expires: number;
}
