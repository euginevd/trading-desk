// The api's /portfolio reply (apps/api/src/api/portfolio.py). Numbers come as strings to keep precision.
export type Num = string | null;

export interface Holding {
  asset: string;
  amount: string;
  price: Num;
  value: Num;
  change24h: Num;
  share: Num;
  averageCost: Num;
  covered: Num;
  profit: Num;
  profitPercent: Num;
}

export interface Order {
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
}

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
  quoteFree: string;
  baseFree: string;
  step: string;
  tick: string;
  minOrder: string;
  settings: Settings;
  trades: SmartTrade[];
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
