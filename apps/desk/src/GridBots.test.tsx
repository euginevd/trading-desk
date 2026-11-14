import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import GridBots from "./GridBots";

import type { GridBot, GridBots as Grids, GridDetail, GridPreview, GridSuggestion } from "./types";

const config: GridBot["config"] = {
  lower: "60000",
  upper: "72000",
  grids: 10,
  spacing: "geometric",
  investment: "200",
  buyFirst: true,
  stopBelow: null,
  perOrder: "20",
  profitPerGrid: ["1.63", "1.63"],
};

const grid: GridBot = {
  id: 1,
  ref: "GRID-1",
  name: "BTC/USDC",
  symbol: "BTCUSDC",
  pair: "BTC/USDC",
  enabled: false,
  status: "off",
  note: null,
  config,
  started: null,
  price: "67000",
  inRange: true,
  openBuys: 0,
  openSells: 0,
  trips: 0,
  gridProfit: "0",
  held: "0",
  unrealised: "0",
};

const backtest = {
  from: 0,
  to: 30 * 86_400_000,
  candles: 720,
  trips: 23,
  gridProfit: "7.52",
  unrealised: "-3.10",
  totalPercent: "2.2",
  holdPercent: "-8.4",
  inRange: "91",
};

const preview: GridPreview = {
  symbol: "BTCUSDC",
  pair: "BTC/USDC",
  quote: "USDC",
  price: "67000",
  config,
  suggested: { lower: "60000", upper: "72000" },
  inRange: true,
  lines: [
    { price: "60000", side: "buy" },
    { price: "67000", side: "none" },
    { price: "72000", side: "sell" },
  ],
  opening: { buys: 6, buyFirst: 3, buyFirstSpend: "55.80", spend: "175.80" },
  available: "500.00",
  settings: { tradingOn: true, perOrder: "50", perDay: "500", spentToday: "0", leftToday: "500" },
  problems: [],
  chart: [
    { t: 1, o: "66000", h: "66500", l: "65800", c: "66000" },
    { t: 2, o: "66000", h: "67200", l: "65900", c: "67000" },
  ],
  backtest,
};

const suggestion: GridSuggestion = {
  symbol: "ETHUSDC",
  config: { ...config, lower: "1700", upper: "2100", grids: 15, stopBelow: "1615" },
  reasons: {
    lower: "From the last 30 days' low and high: it did best for ETH over 30 days",
    grids: "15 grids made 23 round trips in 30 days, 1.4% each after fees",
  },
  backtest,
};

const detail: GridDetail = {
  grid: { ...grid, enabled: true, status: "running", openBuys: 1, trips: 1, gridProfit: "0.90" },
  orders: [
    {
      ref: "GRID-1-9",
      side: "buy",
      line: 2,
      price: "63000",
      qty: "0.0003",
      status: "open",
      filled: "0",
      profit: null,
      time: 1,
    },
    {
      ref: "GRID-1-5",
      side: "sell",
      line: 4,
      price: "68000",
      qty: "0.0003",
      status: "filled",
      filled: "0.0003",
      profit: "0.90",
      time: 1,
    },
  ],
};

function serve(grids: GridBot[]) {
  let current: Grids = { quote: "USDC", tradingOn: true, grids };
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
    if (path === "/grids/preview") body = preview;
    if (path === "/grids/suggest") body = suggestion;
    if (path === "/grids/1" && method === "GET") body = detail;
    if (path === "/grids" && method === "POST") {
      current = { ...current, grids: [...current.grids, { ...grid, id: 2, ref: "GRID-2" }] };
      body = current;
    }
    if (path?.endsWith("/switch")) {
      const on = (JSON.parse(String(init?.body)) as { on: boolean }).on;
      current = {
        ...current,
        grids: current.grids.map((g) => ({ ...g, enabled: on, status: on ? "running" : "off" })),
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

describe("grid bot page", () => {
  it("starts a grid only after the confirm that states its orders", async () => {
    const fetch = serve([grid]);
    render(<GridBots />);
    const row = (await screen.findByText("GRID-1")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Start" }));
    expect(sent(fetch, "/grids/1/switch")).toHaveLength(0);
    expect(await screen.findByText(/limit orders of about 20.00 USDC each/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch on" }));
    await waitFor(() => expect(sent(fetch, "/grids/1/switch")).toHaveLength(1));
  });

  it("creates a grid from a watchlist coin, prefilled from 30 days with a reason each", async () => {
    const fetch = serve([]);
    render(<GridBots />);
    await screen.findByText("No grid bots yet");
    fireEvent.click(screen.getAllByRole("button", { name: /Create bot/ })[0] as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: "ETH" }));
    expect(await screen.findByText("+7.52 USDC")).toBeTruthy(); // the backtest's grid profit
    expect(screen.getByText("holding -8.4%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // Range
    expect((screen.getByLabelText("Lower price") as HTMLInputElement).value).toBe("1700");
    expect(screen.getByText(/15 grids made 23 round trips/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // Investment
    fireEvent.click(screen.getByRole("button", { name: "Create bot" }));
    await waitFor(() => expect(sent(fetch, "/grids")).toHaveLength(1));
    const request = JSON.parse(String(sent(fetch, "/grids")[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(request).toMatchObject({ symbol: "ETHUSDC", grids: "15", stopBelow: "1615" });
  });

  it("opens a grid's live orders and history by reference", async () => {
    serve([{ ...grid, enabled: true, status: "running" }]);
    render(<GridBots />);
    const row = (await screen.findByText("GRID-1")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Orders" }));
    expect(await screen.findByText("GRID-1-9")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "History (1)" }));
    expect(screen.getByText("GRID-1-5")).toBeTruthy();
  });
});
