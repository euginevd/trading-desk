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
