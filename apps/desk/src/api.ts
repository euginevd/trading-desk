import type {
  AccountCoin,
  PotAction,
  PotCheck,
  PotAnalysis,
  RiskBoard,
  PotJudge,
  PotPreview,
  PotScreen,
  PotStyleKey,
  PotStyles,
  PotTrade,
  PotTradeRequest,
  PotView,
  DcaAction,
  DcaCheck,
  FundsPlan,
  DcaBook,
  DcaOdds,
  DcaOrder,
  DcaOrderRequest,
  DcaPlan,
  DcaWeekPlan,
  Drift,
  JournalData,
  SellCheck,
  TaxReport,
  TelegramSettings,
  AgentThread,
  Coach,
  AgentInfo,
  CommandReply,
  ProfilePage,
  ProfileSuggestion,
  ProfileVersion,
  ProfileVersionDetail,
  Recap,
  RuleBreak,
  AiMode,
  AiSettings,
  Interval,
  Market,
  OrderRequest,
  Portfolio,
  Settings,
  Terminal,
  Ticker,
  Watchlist,
  FyDeposits,
  Sentiment,
  SentimentDetail,
  MarketGlobal,
  DcaBots,
  DcaPreview,
  DcaRequest,
  DcaDetail,
  DcaSuggestion,
  GridDetail,
  GridSuggestion,
  GridBots,
  GridPreview,
  GridRequest,
  AgentCall,
  AgentPage,
  MyAgentsPage,
  AgentRun,
  CoinRank,
  MarkdownFile,
  PriceAlert,
  TicketChoice,
  BacktestRun,
  BacktestStyleKey,
  BacktestView,
} from "./types";

export class ApiError extends Error {
  // A buy that breaks a Profile rule is held with each rule named (decision 58).
  readonly ruleBreaks: RuleBreak[];
  constructor(message: string, ruleBreaks: RuleBreak[] = []) {
    super(message);
    this.ruleBreaks = ruleBreaks;
  }
}

// The one place that reaches the api (code-standards 4); the dev server proxies /api to it.
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    // The api takes changes only as JSON (its guard against other sites), so a change with
    // nothing to say still sends an empty object.
    const sent = body === undefined && method !== "GET" ? {} : body;
    response = await fetch(`/api${path}`, {
      method,
      headers: sent === undefined ? undefined : { "content-type": "application/json" },
      body: sent === undefined ? undefined : JSON.stringify(sent),
    });
  } catch {
    throw new ApiError("The desk's api isn't running. Start it, then try again.");
  }
  const reply: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      reply && typeof reply === "object" && "error" in reply
        ? String(reply.error)
        : "The api couldn't answer. Check it's running, then try again.";
    const breaks =
      reply && typeof reply === "object" && "ruleBreaks" in reply && Array.isArray(reply.ruleBreaks)
        ? (reply.ruleBreaks as RuleBreak[])
        : [];
    throw new ApiError(message, breaks);
  }
  return reply as T;
}

export const getPortfolio = () => call<Portfolio>("GET", "/portfolio");
export const getDeposits = () => call<FyDeposits>("GET", "/deposits");
export const getSentiment = () => call<Sentiment>("GET", "/sentiment");
export const getGlobal = () => call<MarketGlobal>("GET", "/global");
export const getSentimentDetail = () => call<SentimentDetail>("GET", "/sentiment/detail");
export const getTerminal = (symbol: string) =>
  call<Terminal>("GET", `/trade?symbol=${encodeURIComponent(symbol)}`);
export const getSettings = () => call<Settings>("GET", "/settings");
export const getAiSettings = () => call<AiSettings>("GET", "/settings/ai");
export const setAiSettings = (mode: AiMode, fallback: boolean, model: string) =>
  call<AiSettings>("PUT", "/settings/ai", { mode, fallback, model });
// Credentials go to .env through the api and never come back (decision 51).
export const saveAiKey = (key: string) => call<AiSettings>("PUT", "/settings/ai/key", { key });
export const startSignIn = () => call<{ url: string }>("POST", "/settings/ai/signin", {});
export const finishSignIn = (code: string) =>
  call<AiSettings>("POST", "/settings/ai/signin/finish", { code });
export const setTrading = (on: boolean) => call<Settings>("PUT", "/trading", { on });
export const setLimits = (perOrder: string, perDay: string) =>
  call<Settings>("PUT", "/limits", { perOrder, perDay });

export const getTickers = (coins: string[]) =>
  call<{ tickers: Ticker[] }>("GET", `/tickers?coins=${encodeURIComponent(coins.join(","))}`);
const listQuery = (list?: number) => (list ? `?list=${encodeURIComponent(list)}` : "");
export const getWatchlist = (list?: number) =>
  call<Watchlist>("GET", `/watchlist${listQuery(list)}`);
export const watchCoin = (coin: string, list: number) =>
  call<Watchlist>("POST", "/watchlist", { coin, list });
export const unwatchCoin = (coin: string, list: number) =>
  call<Watchlist>("DELETE", `/watchlist/${encodeURIComponent(coin)}${listQuery(list)}`, {});
export const createWatchlist = (name: string) => call<Watchlist>("POST", "/watchlists", { name });
export const deleteWatchlist = (list: number) =>
  call<Watchlist>("DELETE", `/watchlists/${encodeURIComponent(list)}`, {});
export const getMarket = (coin: string, interval: Interval) =>
  call<Market>(
    "GET",
    `/market?symbol=${encodeURIComponent(coin)}&interval=${encodeURIComponent(interval)}`,
  );
export const placeOrder = (request: OrderRequest) =>
  call<{ message: string }>("POST", "/orders", request);
// The owner's average cost for a holding with no trades here; null clears it (decision 27).
export const setCost = (source: string, asset: string, averageCost: string | null) =>
  call<{ averageCost: string | null }>("PUT", "/cost", { source, asset, averageCost });

export const cancelOrder = (symbol: string, orderId: number) =>
  call<{ message: string }>("POST", "/orders/cancel", { symbol, orderId });

// DCA bots (decision 37): created switched off; switching on carries the owner's confirm.
export const getBots = () => call<DcaBots>("GET", "/bots");
export const previewBot = (request: DcaRequest) =>
  call<DcaPreview>("POST", "/bots/preview", request);
export const suggestBot = (symbol: string) =>
  call<DcaSuggestion>("POST", "/bots/suggest", { symbol });
export const getBot = (id: number) => call<DcaDetail>("GET", `/bots/${id}`);
export const createBot = (request: DcaRequest) => call<DcaBots>("POST", "/bots", request);
export const editBot = (id: number, request: DcaRequest) =>
  call<DcaBots>("PUT", `/bots/${id}`, request);
export const deleteBot = (id: number) => call<DcaBots>("DELETE", `/bots/${id}`, {});
export const switchBot = (id: number, on: boolean, override = false) =>
  call<DcaBots>("POST", `/bots/${id}/switch`, {
    on,
    confirmed: on,
    ...(override ? { override } : {}),
  });

// Grid bots (decision 38): created switched off, like the DCA bots.
export const getGrids = () => call<GridBots>("GET", "/grids");
export const previewGrid = (request: GridRequest) =>
  call<GridPreview>("POST", "/grids/preview", request);
export const suggestGrid = (symbol: string) =>
  call<GridSuggestion>("POST", "/grids/suggest", { symbol });
export const getGrid = (id: number) => call<GridDetail>("GET", `/grids/${id}`);
export const createGrid = (request: GridRequest) => call<GridBots>("POST", "/grids", request);
export const editGrid = (id: number, request: GridRequest) =>
  call<GridBots>("PUT", `/grids/${id}`, request);
export const deleteGrid = (id: number) => call<GridBots>("DELETE", `/grids/${id}`, {});
export const switchGrid = (id: number, on: boolean) =>
  call<GridBots>("POST", `/grids/${id}/switch`, { on, confirmed: on });

// Ladder buys on the smart trade (decision 39): all rungs checked together, then placed.

// Smart trades (decision 41): one-off DCA deals, entered at the owner's price.
export const getSmart = () => call<DcaBots>("GET", "/smart");
export const closeBot = (id: number) => call<DcaBots>("POST", `/bots/${id}/close`, {});

// A new price or amount for an open limit order, swapped on Binance in one step (decision 43).
export const editOrder = (request: {
  symbol: string;
  orderId: number;
  price: string;
  amount: string;
  clientId: string;
}) => call<{ message: string; orderId: number }>("POST", "/orders/edit", request);

// The coach and the agents (decisions 52 and 59).
export const getCoach = () => call<Coach>("GET", "/coach");
export const writeCoach = () => call<Coach>("POST", "/coach/message", {});
export const getAgents = () => call<{ agents: AgentInfo[] }>("GET", "/agents");
export const getAgent = (id: string) => call<AgentThread>("GET", `/agents/${id}`);
export const sendAgent = (id: string, text: string) =>
  call<AgentThread>("POST", `/agents/${id}`, { text });

// Tax lots, drift, the Journal and Telegram (decisions 54 to 57).
export const getTax = () => call<TaxReport>("GET", "/tax");
export const sellCheck = (coin: string, qty: string) =>
  call<SellCheck>(
    "GET",
    `/tax/sell-check?coin=${encodeURIComponent(coin)}&qty=${encodeURIComponent(qty)}`,
  );
export const getDrift = () => call<Drift>("GET", "/rebalance");
export const getJournal = () => call<JournalData>("GET", "/journal");
export const tagTrade = (key: string, setups: string[], mistakes: string[]) =>
  call<{ setups: string[]; mistakes: string[] }>("PUT", "/journal/tags", { key, setups, mistakes });
export const setJournalLists = (setups: string[], mistakes: string[]) =>
  call<JournalData["lists"]>("PUT", "/journal/lists", { setups, mistakes });
export const getTelegram = () => call<TelegramSettings>("GET", "/settings/telegram");
export const setTelegramTime = (time: string) =>
  call<TelegramSettings>("PUT", "/settings/telegram", { time });
export const saveTelegramToken = (token: string) =>
  call<TelegramSettings>("PUT", "/settings/telegram/token", { token });
export const testTelegram = () => call<TelegramSettings>("POST", "/settings/telegram/test", {});
export const linkTelegram = () => call<TelegramSettings>("POST", "/settings/telegram/link", {});

// The Profile (decision 58).
export const getProfilePage = () => call<ProfilePage>("GET", "/profile");
export const getProfileVersions = () =>
  call<{ versions: ProfileVersion[] }>("GET", "/profile/versions");
export const getProfileVersion = (n: number) =>
  call<ProfileVersionDetail>("GET", `/profile/versions/${n}`);
export const restoreProfile = (n: number) => call<ProfilePage>("POST", "/profile/restore", { n });
// The command bar (decision 62): an answer, or a change to profile.md shown as a diff to accept.
export const askProfile = (text: string) =>
  call<CommandReply>("POST", "/profile/command", { text });
export const acceptSuggestion = (id: string) =>
  call<ProfilePage>("POST", `/profile/suggestions/${id}/accept`, {});
export const rejectSuggestion = (id: string) =>
  call<{ suggestions: ProfileSuggestion[] }>("POST", `/profile/suggestions/${id}/reject`, {});
export const getRecaps = () => call<{ recaps: Recap[] }>("GET", "/recaps");
export const writeRecap = () => call<{ recap: Recap }>("POST", "/recaps", {});

// The trading agent (TODO 6): its profile, read from local/trade.md, and Analyse runs.
export const getTradingAgent = () => call<AgentPage>("GET", "/agent");
// The owner's files, read only (decision 61): they change them by asking Claude Code.
export const getProfileFile = () => call<MarkdownFile>("GET", "/profile/file");
// My agents (TODO 10): one file each in local/agents/, read only.
// risk-agent (local/agents/risk-agent.md).
export const getRiskBoard = () => call<RiskBoard>("GET", "/risk-board");
export const writeRiskReview = () => call<RiskBoard>("POST", "/risk-board/review");
// A backup check done today, or TAO's thesis still holding: the desk keeps the date only.
export const markRisk = (key: string) => call<RiskBoard>("POST", "/risk-board/check", { key });
export const getMyAgents = () => call<MyAgentsPage>("GET", "/my-agents");
export const setAgentsOn = (on: boolean) => call<unknown>("PUT", "/my-agents/schedule", { on });
export const getMyAgentFile = (slug: string) =>
  call<{ markdown: string; error: string | null }>(
    "GET",
    `/my-agents/file?slug=${encodeURIComponent(slug)}`,
  );

// Analyse: start a run, then ask for one step at a time until it isn't running.
export const startAnalysis = (coin: string) => call<AgentRun>("POST", "/analyse", { coin });
export const nextAnalysisStep = (id: number) => call<AgentRun>("POST", "/analyse/next", { id });
export const getLastAnalysis = (coin: string) =>
  call<{ run: AgentRun | null }>("GET", `/analyse/last?coin=${encodeURIComponent(coin)}`);
export const getAnalysisCalls = () => call<{ calls: AgentCall[] }>("GET", "/analyse/calls");
export const askAnalysis = (id: number, question: string) =>
  call<AgentRun>("POST", "/analyse/ask", { id, question });
export const chooseTicket = (id: number, choice: TicketChoice) =>
  call<AgentRun>("POST", "/analyse/choice", { id, choice });
export const rankCoins = (coins: string[]) =>
  call<{ ranked: CoinRank[]; cost: string }>("POST", "/analyse/rank", { coins });

// Price alerts (decision 46), set from the agent's Watch for lines.
export const getAlerts = (coin: string) =>
  call<{ alerts: PriceAlert[] }>("GET", `/alerts?coin=${encodeURIComponent(coin)}`);
export const addAlert = (alert: {
  coin: string;
  direction: "above" | "below";
  price: string;
  note: string;
}) => call<{ alerts: PriceAlert[] }>("POST", "/alerts", alert);
export const deleteAlert = (id: number) =>
  call<{ alerts: PriceAlert[] }>("DELETE", `/alerts/${id}`, {});

// The DCA book (TODO 11).
export const getDcaBook = () => call<DcaBook>("GET", "/dca");
export const setDcaPlan = (plan: DcaPlan) => call<DcaBook>("PUT", "/dca/plan", plan);
export const suggestDca = () => call<DcaWeekPlan>("GET", "/dca/suggest");
export const dcaOdds = (coin: string, price: string) =>
  call<DcaOdds & { now: string }>(
    "GET",
    `/dca/odds?coin=${encodeURIComponent(coin)}&price=${encodeURIComponent(price)}`,
  );
export const placeDcaOrder = (order: DcaOrderRequest) =>
  call<DcaOrder>("POST", "/dca/orders", order);
export const cancelDcaOrder = (ref: string) =>
  call<DcaOrder>("POST", "/dca/orders/cancel", { ref });
export const closeOutDca = () => call<{ closed: string[] }>("POST", "/dca/close-out");
// The desk's own plan at once; dca-agent's only when asked.
export const analyseFunds = (side: "add" | "remove", amount: string, agent = false) =>
  call<FundsPlan>("POST", "/dca/funds/analyse", { side, amount, agent });
export const chatFunds = (body: {
  side: "add" | "remove";
  amount: string;
  orders: { coin: string; usdc: string; price: string; reason: string }[];
  history: { who: "you" | "agent"; text: string }[];
  message: string;
}) => call<FundsPlan>("POST", "/dca/funds/chat", body);
export const fundsOdds = (coin: string, price: string, side: "add" | "remove") =>
  call<{ hit: number; windows: number; pct: number | null; now: string }>(
    "GET",
    `/dca/funds/odds?coin=${encodeURIComponent(coin)}&price=${encodeURIComponent(price)}&side=${side}`,
  );
export const checkDca = () => call<DcaCheck>("GET", "/dca/check");
export const fixDca = () => call<DcaCheck>("POST", "/dca/check/fix");
export const agentChat = (message: string, history: { who: string; text: string }[]) =>
  call<{ reply: string; actions: DcaAction[]; said: string[]; quote: string }>(
    "POST",
    "/dca/agent",
    {
      message,
      history,
    },
  );
// spend or qty only when the owner changed it (the api keeps what's left otherwise); raise
// when a buy's new amount is more than what's left of it.
export const amendDcaOrder = (change: {
  ref: string;
  price: string;
  spend?: string;
  qty?: string;
  raise?: boolean;
}) => call<DcaOrder>("POST", "/dca/orders/amend", change);

// The trading pot (docs/plan-trade.md).
export const getPot = () => call<PotView>("GET", "/pot");
export const putInPot = (usdc: string) => call<PotView>("POST", "/pot/put-in", { usdc });
export const previewPotTrade = (body: {
  coin: string;
  entry?: string;
  stop?: string;
  target?: string;
  style?: PotStyleKey;
}) => call<PotPreview>("POST", "/pot/preview", body);
export const analysePotCoin = (body: {
  coin: string;
  entry?: string;
  stop?: string;
  target?: string;
}) => call<PotAnalysis>("POST", "/pot/analyse", body);
export const placePotTrade = (body: PotTradeRequest) => call<PotTrade>("POST", "/pot/trades", body);
export const cancelPotTrade = (ref: string) =>
  call<PotTrade>("POST", "/pot/trades/cancel", { ref });
export const movePotStop = (ref: string, stop: string) =>
  call<PotTrade>("POST", "/pot/trades/stop", { ref, stop });
export const closePotTrade = (ref: string) => call<PotTrade>("POST", "/pot/trades/close", { ref });
export const enterPotTradeNow = (ref: string, override = false) =>
  call<PotTrade>("POST", "/pot/trades/enter-now", { ref, ...(override ? { override } : {}) });
export const addToPotTrade = (ref: string, usdc: string, override = false) =>
  call<PotTrade>("POST", "/pot/trades/add", { ref, usdc, ...(override ? { override } : {}) });
export const reducePotTrade = (ref: string, pct: number) =>
  call<PotTrade>("POST", "/pot/trades/reduce", { ref, pct: String(pct) });
export const movePotTarget = (ref: string, target: string) =>
  call<PotTrade>("POST", "/pot/trades/target", { ref, target });
export const notePotTrade = (ref: string, text: string) =>
  call<PotTrade>("POST", "/pot/trades/note", { ref, text });
export const scanPot = () => call<PotView>("POST", "/pot/scan");
export const getPotStyles = () => call<PotStyles>("GET", "/pot/styles");

// The Backtest page (decision 85): runs Freqtrade through the worker, reads its results.
export const getBacktests = () => call<BacktestView>("GET", "/backtest");
export const getBacktestRun = (id: string) =>
  call<BacktestRun>("GET", `/backtest/run?id=${encodeURIComponent(id)}`);
export const startBacktest = (run: {
  style: BacktestStyleKey;
  ai: boolean;
  from: string;
  to: string;
}) => call<BacktestView>("POST", "/backtest/jobs", run);
export const cancelBacktest = (id: string) =>
  call<BacktestView>("POST", "/backtest/jobs/cancel", { id });
export const screenPot = (style: PotStyleKey) => call<PotScreen>("POST", "/pot/screen", { style });
export const judgePot = (style: PotStyleKey) => call<PotJudge>("POST", "/pot/judge", { style });
export const dismissPotProposal = (id: string) =>
  call<PotView>("POST", "/pot/proposals/dismiss", { id });
export const potAgent = (message: string, history: { who: string; text: string }[]) =>
  call<{ reply: string; actions: PotAction[]; said: string[] }>("POST", "/pot/agent", {
    message,
    history,
  });
export const checkPot = () => call<PotCheck>("GET", "/pot/check");
export const getAccountCoins = () =>
  call<{ quote: string; list: number; max: number; coins: AccountCoin[] }>("GET", "/pot/coins");
