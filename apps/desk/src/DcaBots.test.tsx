import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DcaBots from "./DcaBots";

import type { DcaBot, DcaBots as Bots, DcaDetail, DcaPreview, DcaSuggestion } from "./types";

const config: DcaBot["config"] = {
  timeframe: "1h",
  bbLength: 20,
  bbDeviation: "2",
  baseOrder: "25",
  dcaOrder: "20",
  deviation: "2",
  maxDcaOrders: 5,
  sizeMultiplier: "1.2",
  deviationMultiplier: "1",
  takeProfit: "1.5",
  maxDeals: 1,
};

const bot: DcaBot = {
  id: 1,
  ref: "DCA-1",
  name: "BTC/USDC",
  symbol: "BTCUSDC",
  pair: "BTC/USDC",
  enabled: false,
  status: "off",
  note: null,
  config,
  budget: "173.83",
  maxBudget: "173.83",
  covers: "10",
  price: "67224.05",
  lower: "66410",
  deals: [],
  closed: 2,
  profit: "3.10",
};

const backtest = {
  from: 0,
  to: 30 * 86_400_000,
  candles: 720,
  deals: 12,
  expired: 2,
  profit: "8.41",
  profitPercent: "4.8",
  mostDcaFilled: 3,
  mostSpent: "97.8",
  worstDrawdown: "-6.2",
  averageHours: "14.5",
  openDeal: false,
  unrealised: "0",
};

const preview: DcaPreview = {
  symbol: "BTCUSDC",
  pair: "BTC/USDC",
  quote: "USDC",
  price: "67224.05",
  band: { lower: "66410", middle: "68000", upper: "69590" },
  met: false,
  ladder: [
    {
      rung: 0,
      drop: "0",
      price: "67224.05",
      qty: "0.00037",
      spend: "24.87",
      total: "24.87",
      average: "67224.05",
      takeProfit: "68232.42",
    },
    {
      rung: 1,
      drop: "2",
      price: "65879.57",
      qty: "0.0003",
      spend: "19.76",
      total: "44.63",
      average: "66619.79",
      takeProfit: "67619.09",
    },
  ],
  budget: "44.63",
  covers: "2",
  available: "500.00",
  settings: { tradingOn: true, perOrder: "50", perDay: "500", spentToday: "0", leftToday: "500" },
  problems: [],
  chart: [
    { t: 1, o: "68100", h: "68200", l: "67900", c: "68000", lower: "66000", upper: "70000" },
    { t: 2, o: "68000", h: "68050", l: "67100", c: "67224.05", lower: "66410", upper: "69590" },
  ],
  backtest,
};

const suggestion: DcaSuggestion = {
  symbol: "ETHUSDC",
  config: { ...config, deviation: "1.5", takeProfit: "2" },
  reasons: {
    deviation: "1.5% steps did best of 1 to 3% over 30 days",
    takeProfit: "2% over the average closed 12 deals for 8.41 USDC in 30 days",
  },
  backtest,
};

const detail: DcaDetail = {
  bot: { ...bot, enabled: true, status: "deal" },
  deals: [
    {
      id: 7,
      ref: "D-7",
      status: "open",
      started: 1,
      ended: null,
      profit: null,
      note: null,
      spent: "44.63",
      average: "66619.79",
      takeProfit: "67619.09",
      filled: 1,
      of: 5,
      unrealised: "0.27",
      orders: [
        {
          ref: "D-7-0",
          kind: "Base order",
          side: "buy",
          price: "67224.05",
          qty: "0.00037",
          spend: "24.87",
          status: "filled",
          filled: "0.00037",
          time: 1,
        },
      ],
    },
    {
      id: 3,
      ref: "D-3",
      status: "closed",
      started: 1,
      ended: 2,
      profit: "1.20",
      note: null,
      orders: [],
    },
  ],
};

function serve(bots: DcaBot[]) {
  let current: Bots = { quote: "USDC", tradingOn: true, bots };
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "").split("?")[0];
    const method = init?.method ?? "GET";
    let body: unknown = current;
    if (path === "/watchlist") {
      body = {
        lists: [{ id: 1, name: "Main", count: 2 }],
        list: { id: 1, name: "Main" },
        coins: [{ coin: "BTC" }, { coin: "ETH" }],
      };
    }
    if (path === "/bots/preview") body = preview;
    if (path === "/bots/suggest") body = suggestion;
    if (path === "/bots/1" && method === "GET") body = detail;
    if (path === "/bots" && method === "POST") {
      current = { ...current, bots: [...current.bots, { ...bot, id: 2, ref: "DCA-2" }] };
      body = current;
    }
    if (path?.endsWith("/switch")) {
      const on = (JSON.parse(String(init?.body)) as { on: boolean }).on;
      current = {
        ...current,
        bots: current.bots.map((b) => ({ ...b, enabled: on, status: on ? "waiting" : "off" })),
      };
      body = current;
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function sent(fetch: ReturnType<typeof serve>, path: string) {
  return fetch.mock.calls.filter(
    ([url, init]) => init?.method === "POST" && String(url) === `/api${path}`,
  );
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DCA bot page", () => {
  it("says what a bot does when there are none, with a Create bot menu", async () => {
    serve([]);
    render(<DcaBots />);
    expect(await screen.findByText("No DCA bots yet")).toBeTruthy();
    expect(screen.queryByText(/decision/)).toBeNull();
  });

  it("starts a bot only after the confirm that states its orders", async () => {
    const fetch = serve([bot]);
    render(<DcaBots />);
    const row = (await screen.findByText("DCA-1")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Start" }));
    expect(sent(fetch, "/bots/1/switch")).toHaveLength(0); // the confirm first
    expect(await screen.findByText(/6 limit buys totalling up to 173.83 USDC/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch on" }));
    await waitFor(() => expect(sent(fetch, "/bots/1/switch")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/bots/1/switch")[0]?.[1]?.body))).toEqual({
      on: true,
      confirmed: true,
    });
  });

  it("creates a bot from a watchlist coin, prefilled from 30 days with a reason each", async () => {
    const fetch = serve([]);
    render(<DcaBots />);
    await screen.findByText("No DCA bots yet");
    fireEvent.click(screen.getAllByRole("button", { name: /Create bot/ })[0] as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: "ETH" }));
    expect(await screen.findByText(/did best for ETH over the last 30 days/)).toBeTruthy();
    expect(await screen.findByText("+8.41 USDC")).toBeTruthy(); // the backtest
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // Entry
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // Orders
    expect((screen.getByLabelText("Deviation") as HTMLInputElement).value).toBe("1.5");
    expect(screen.getByText("1.5% steps did best of 1 to 3% over 30 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // Exit
    fireEvent.click(screen.getByRole("button", { name: "2" })); // two deals at once
    fireEvent.click(screen.getByRole("button", { name: "Create bot" }));
    await waitFor(() => expect(sent(fetch, "/bots")).toHaveLength(1));
    const request = JSON.parse(String(sent(fetch, "/bots")[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(request).toMatchObject({ symbol: "ETHUSDC", takeProfit: "2", maxDeals: 2 });
    expect(request.name).toBeUndefined(); // the name is the pair
  });

  it("opens a bot's live and closed positions by reference", async () => {
    serve([{ ...bot, enabled: true, status: "waiting" }]);
    render(<DcaBots />);
    const row = (await screen.findByText("DCA-1")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Positions" }));
    expect(await screen.findByText("D-7")).toBeTruthy();
    expect(screen.getByText("D-7-0")).toBeTruthy();
    const orders = screen.getByText("D-7-0").closest("table") as HTMLElement;
    expect(within(orders).getByText("Base order")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "History (1)" }));
    expect(screen.getByText("D-3")).toBeTruthy();
    expect(screen.getByText("+1.20 USDC")).toBeTruthy();
  });
});
