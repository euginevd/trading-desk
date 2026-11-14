import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Trade from "./Trade";

import type { Market, PlanFacts, Settings, Signal, Terminal, Watchlist } from "./types";

const limits: Settings = {
  tradingOn: true,
  perOrder: "100",
  perDay: "500",
  spentToday: "0",
  leftToday: "500",
};

const signal: Signal = {
  coin: "SOL",
  verdict: "Buy now",
  confidence: 72,
  sentiment: "Bullish",
  trend: "Up, pulling back",
  rsi: "44.8",
  support: "176",
  resistance: "198",
  buyLevel: "178.5",
  price: "182.4",
  summary: "Healthy pullback into support inside a larger uptrend.",
  reasons: ["Testing 176 support", "RSI cooled from 68 to 45", "News positive"],
  model: "claude-opus-5-5",
  ranAt: Date.now() - 120_000,
  stale: false,
  action: "Add",
  confidenceBefore: 58,
  horizons: { short: "Wait", swing: "Add", long: "Hold" },
  zones: {
    buy: { low: "170", high: "178.5" },
    noChase: "198",
    invalidation: { price: "170", next: "160" },
    trim: { low: "198", high: "210" },
  },
  why: {
    bull: "Held the weekly swing low at 176",
    bear: "Daily trend still down",
    changeMind: "A daily close under 170",
  },
  watchFor: [{ price: "198", direction: "above", note: "Breakout over resistance" }],
  changedSince: "Confidence up as support held",
  context: [],
};

// The live facts for the panel: 10 SOL held at an average of 200, worth 1,824 of 10,000.
function plan(held: boolean): PlanFacts {
  return {
    coin: "SOL",
    pair: "SOL/USDC",
    quote: "USDC",
    price: "182.4",
    position: held
      ? {
          held: true,
          qty: "10",
          avgCost: "200",
          invested: "2000",
          value: "1824",
          pnl: "-176",
          pnlPct: "-8.8",
          weightPct: "18.2",
        }
      : {
          held: false,
          qty: "0",
          avgCost: null,
          invested: "0",
          value: "0",
          pnl: null,
          pnlPct: null,
          weightPct: "0",
        },
    cash: "1250",
    total: "10000",
    audPerUsd: "1.5",
    rules: { maxCoinPct: "25", tradeBudgetAud: "500", maxLossPct: "20" },
    whatIf: {
      amount: "333.33",
      price: "178.5",
      newAvg: null,
      breakEvenBefore: null,
      breakEvenAfter: null,
      weightBefore: null,
      weightAfter: null,
      cashLeft: null,
    },
    checks: { canAdd: true, pastMaxLoss: false, notes: [] },
    levels: [],
    track: { scored: 20, correct: 13, hours: 24 },
    alerts: [],
  };
}

function watchlist(withSignal: boolean): Watchlist {
  return {
    lists: [
      { id: 1, name: "Portfolio", count: 2 },
      { id: 2, name: "Memes", count: 0 },
    ],
    list: { id: 1, name: "Portfolio" },
    coins: [
      {
        coin: "SOL",
        symbol: "SOLUSDT",
        pair: "SOL/USDT",
        price: "182.4",
        change24h: "-1.9",
        signal: withSignal ? signal : null,
      },
      {
        coin: "BTC",
        symbol: "BTCUSDT",
        pair: "BTC/USDT",
        price: "98400",
        change24h: "2.1",
        signal: null,
      },
    ],
    max: 10,
    aiBudget: { spent: "0.36", cap: "20" },
  };
}

const market: Market = {
  symbol: "SOLUSDT",
  coin: "SOL",
  pair: "SOL/USDC",
  quote: "USDC",
  interval: "4h",
  price: "182.4",
  change24h: "-1.9",
  high24h: "186.2",
  low24h: "176.6",
  volume24h: "640000000",
  candles: [
    { t: 1, o: "180", h: "184", l: "178", c: "183", v: "100" },
    { t: 2, o: "183", h: "185", l: "181", c: "182.4", v: "120" },
  ],
  indicators: {
    rsi: "44.8",
    sma20: "180",
    sma50: "175",
    support: "176",
    resistance: "198",
    trend: "Up",
  },
  levels: [
    { name: "Month open", price: "205" },
    { name: "Week open", price: "190" },
    { name: "Day open", price: "180" },
  ],
};

function terminal(settings: Settings): Terminal {
  return {
    symbol: "SOLUSDT",
    pair: "SOL/USDT",
    pairs: [],
    price: "182.4",
    change24h: "-1.9",
    base: "SOL",
    quote: "USDC",
    quoteFree: "1250",
    baseFree: "42.5",
    step: "0.001",
    tick: "0.01",
    minOrder: "5",
    settings,
    trades: [],
    openOrders: [
      {
        orderId: 9,
        symbol: "SOLUSDT",
        time: 1,
        pair: "SOL/USDT",
        side: "Buy",
        type: "Limit",
        price: "168",
        amount: "10",
        filled: "0",
      },
    ],
  };
}

function serve(settings: Settings, withSignal = true, held = true) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "").split("?")[0];
    const method = init?.method ?? "GET";
    let body: unknown = {};
    if (path === "/watchlist" && method === "GET") body = watchlist(withSignal);
    if (path === "/watchlist" && method === "POST") body = watchlist(withSignal);
    if (path === "/watchlists" && method === "POST") {
      body = { ...watchlist(false), list: { id: 3, name: "Alts" }, coins: [] };
    }
    if (path === "/market") body = market;
    if (path === "/trade") body = terminal(settings);
    if (path === "/signal") body = { signal };
    if (path === "/orders") body = { message: "Limit buy placed on SOLUSDT." };
    if (path === "/orders/ladder") body = { message: "Ladder placed: 4 limit buys on SOL/USDC." };
    if (path === "/smart") body = { quote: "USDC", tradingOn: true, bots: [] };
    if (path === "/plan") body = plan(held);
    if (path === "/alerts") body = { alerts: [] };
    if (path === "/bots/suggest") {
      body = {
        symbol: "SOLUSDC",
        config: {
          timeframe: "1h",
          bbLength: 20,
          bbDeviation: "2",
          baseOrder: "25",
          dcaOrder: "20",
          deviation: "2",
          maxDcaOrders: 3,
          sizeMultiplier: "1",
          deviationMultiplier: "1",
          takeProfit: "2",
          maxDeals: 1,
        },
        reasons: {
          maxDcaOrders: "Covers a 6% drop; the deepest dip used 2 of them",
          takeProfit: "2% over the average closed 4 deals for 3.10 USDC in 30 days",
        },
        backtest: {},
      };
    }
    if (path === "/bots" && method === "POST") {
      body = { quote: "USDC", tradingOn: true, bots: [{ id: 5, ref: "TR-5" }] };
    }
    if (path === "/bots/5/switch") body = { quote: "USDC", tradingOn: true, bots: [] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function posts(fetch: ReturnType<typeof serve>, path: string) {
  return fetch.mock.calls.filter(
    ([url, init]) => init?.method === "POST" && String(url).startsWith(`/api${path}`),
  );
}

function show(settings: Settings | null) {
  render(<Trade settings={settings} onSettings={() => undefined} onStatus={() => undefined} />);
}

beforeAll(() => {
  // jsdom has no modal dialogs; open and close them as attributes.
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

describe("trade page", () => {
  it("shows the watchlist, the chart and the AI signal with its reasons", async () => {
    serve(limits);
    show(limits);
    const tv = await screen.findByTitle("TradingView chart of SOL/USDC");
    // Framed from TradingView's own widget site: another origin, so it can't reach the desk.
    const src = tv.getAttribute("src") ?? "";
    expect(src.startsWith("https://www.tradingview-widget.com/embed-widget/advanced-chart/")).toBe(
      true,
    );
    expect(decodeURIComponent(src)).toContain('"symbol":"BINANCE:SOLUSDT"');
    expect(decodeURIComponent(src)).toContain('"hide_volume":true');
    fireEvent.click(screen.getByRole("button", { name: "Reset chart" }));
    const reloaded = await screen.findByTitle("TradingView chart of SOL/USDC");
    expect(reloaded).not.toBe(tv); // a fresh frame: TradingView's own reset
    expect(screen.getAllByText("Buy now").length).toBeGreaterThan(0); // the watchlist's tag
    expect(document.querySelector(".ai-verb")?.textContent).toBe("Add"); // the plan's action
    expect(screen.getByText(", was 58%")).toBeTruthy();
    expect(screen.getByText("Held the weekly swing low at 176")).toBeTruthy();
    expect(screen.getByText("No signal")).toBeTruthy(); // BTC has none yet
    expect(screen.getByText(/AI spend this month: \$0.36 of \$20.00/)).toBeTruthy();
  });

  it("shows the plan for a held coin, with the what-if worked out in code", async () => {
    serve(limits);
    show(limits);
    const strip = await screen.findByText(/You hold/);
    expect(strip.textContent).toContain("10 SOL");
    expect(strip.textContent).toContain("Avg 200.00");
    expect(strip.textContent).toContain("−8.8%");
    expect(strip.textContent).toContain("18% of portfolio");
    expect(screen.getByText("Last 20 signals on SOL: 13 right a day later")).toBeTruthy();
    // Adding 333.33 at 178.50: 10 + 1.8674 = 11.8674 coins for 2,333.33, an average of 196.62.
    expect(screen.getByText("196.62")).toBeTruthy();
    expect(screen.getByText("12.0% → 10.1%")).toBeTruthy(); // 200 / 178.5 and 196.62 / 178.5
    expect(screen.getByText("18.2% → 21.6%")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Amount to add"), { target: { value: "1000" } });
    expect(screen.getByText("18.2% → 28.2%")).toBeTruthy();
    expect(screen.getByText("Over your 25% cap a coin.")).toBeTruthy();
    expect(screen.getByText(/Never your keys. Advice only; you decide./)).toBeTruthy();
  });

  it("shows a coin that isn't held, with the cash available", async () => {
    serve(limits, true, false);
    show(limits);
    expect(await screen.findByText(/You don't hold SOL · \$1,250.00 available/)).toBeTruthy();
  });

  it("prefills the trade form from a zone, without sending anything", async () => {
    const fetch = serve(limits);
    show(limits);
    fireEvent.click(await screen.findByRole("button", { name: "Prefill limit buy" }));
    const entry = (await screen.findByLabelText("Entry price")) as HTMLInputElement;
    expect(entry.value).toBe("178.50"); // the top of the buy zone
    expect(screen.getByText("From the AI plan's buy zone")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prefill limit sell" }));
    expect(((await screen.findByLabelText("Limit price")) as HTMLInputElement).value).toBe(
      "198.00",
    );
    const sent = fetch.mock.calls.filter(
      ([url, init]) => init?.method === "POST" && /\/api\/(orders|bots)$/.test(String(url)),
    );
    expect(sent).toHaveLength(0);
  });

  it("sets an alert from Watch for", async () => {
    const fetch = serve(limits);
    show(limits);
    fireEvent.click(await screen.findByRole("button", { name: "Set alert" }));
    await waitFor(() => expect(posts(fetch, "/alerts")).toHaveLength(1));
    expect(JSON.parse(String(posts(fetch, "/alerts")[0]?.[1]?.body))).toEqual({
      coin: "SOL",
      direction: "above",
      price: "198",
      note: "Breakout over resistance",
    });
  });

  it("walks a new trade from the suggested entry to take profit and stop loss", async () => {
    const fetch = serve(limits);
    show(limits);
    fireEvent.click(await screen.findByRole("button", { name: "New trade" }));
    const entry = (await screen.findByLabelText("Entry price")) as HTMLInputElement;
    expect(entry.value).toBe("178.50"); // the signal's buy level
    expect(screen.getByText("The AI signal's suggested buy level")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // DCA orders
    await waitFor(() =>
      expect((screen.getByLabelText("DCA orders") as HTMLInputElement).value).toBe("3"),
    );
    expect(screen.getByText("Covers a 6% drop; the deepest dip used 2 of them")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // Take profit
    expect((screen.getByLabelText("Take profit over the average") as HTMLInputElement).value).toBe(
      "2",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // Stop loss
    expect((screen.getByLabelText("Sell everything under") as HTMLInputElement).value).toBe(
      "162.75", // 3% under the last DCA order at 167.79
    );
    fireEvent.click(screen.getByRole("button", { name: "Review trade" }));
    const created = () =>
      fetch.mock.calls.filter(([url, init]) => init?.method === "POST" && url === "/api/bots");
    expect(created()).toHaveLength(0); // nothing before the confirm
    expect(screen.getByText(/Place 4 limit buys of SOL\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place trade" }));
    await waitFor(() => expect(posts(fetch, "/bots/5/switch")).toHaveLength(1));
    const made = JSON.parse(String(created()[0]?.[1]?.body)) as Record<string, unknown>;
    expect(made).toMatchObject({
      symbol: "SOLUSDT",
      entryPrice: "178.50",
      maxDcaOrders: 3,
      takeProfitOn: true,
      stopLoss: "162.75",
    });
    expect(await screen.findByText("TR-5 placed: 4 limit buys on SOL/USDT.")).toBeTruthy();
  });

  it("sells from resistance, with Max from what's held", async () => {
    const fetch = serve(limits);
    show(limits);
    fireEvent.click(await screen.findByRole("button", { name: "Sell" }));
    expect((screen.getByLabelText("Limit price") as HTMLInputElement).value).toBe("198.00");
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("42.500");
    fireEvent.click(screen.getByRole("button", { name: "Place limit sell" }));
    await waitFor(() => expect(posts(fetch, "/orders")).toHaveLength(1));
  });

  it("won't place a trade until the limits are set", async () => {
    const unset = { ...limits, perOrder: "0", perDay: "0", leftToday: "0" };
    serve(unset);
    show(unset);
    fireEvent.click(await screen.findByRole("button", { name: "New trade" }));
    expect(screen.getByLabelText("Per order (USDC)")).toBeTruthy();
    for (let n = 0; n < 3; n++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const button = await screen.findByRole("button", { name: "Set your limits first" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the TradingView chart and remembers it", async () => {
    window.localStorage.removeItem("desk.trade.chart");
    serve(limits);
    show(limits);
    await screen.findByTitle("TradingView chart of SOL/USDC");
    fireEvent.click(screen.getByRole("button", { name: "Hide chart" }));
    expect(screen.queryByTitle("TradingView chart of SOL/USDC")).toBeNull();
    expect(window.localStorage.getItem("desk.trade.chart")).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Show chart" }));
    expect(screen.getByTitle("TradingView chart of SOL/USDC")).toBeTruthy();
  });

  it("runs a signal for a coin with none, and re-runs on request", async () => {
    const fetch = serve(limits, false);
    show(limits);
    fireEvent.click(await screen.findByRole("button", { name: "Run analysis" }));
    await waitFor(() => expect(posts(fetch, "/signal")).toHaveLength(1));
    const body = JSON.parse(String(posts(fetch, "/signal")[0]?.[1]?.body)) as {
      force: boolean;
    };
    expect(body.force).toBe(true);
  });

  it("adds a coin and asks for its first signal", async () => {
    const fetch = serve(limits);
    show(limits);
    fireEvent.click(await screen.findByRole("button", { name: /Portfolio/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Portfolio" }));
    expect(screen.getAllByRole("button", { name: /^Remove / }).length).toBe(2); // only while editing
    fireEvent.change(screen.getByLabelText("Add coin"), { target: { value: "avax" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(posts(fetch, "/signal")).toHaveLength(1));
    expect(JSON.parse(String(posts(fetch, "/watchlist")[0]?.[1]?.body))).toEqual({
      coin: "AVAX",
      list: 1,
    });
    expect(JSON.parse(String(posts(fetch, "/signal")[0]?.[1]?.body))).toEqual({
      coin: "AVAX",
      force: false,
    });
  });

  it("shows the list's name, switches lists from its menu, and makes a new one", async () => {
    const fetch = serve(limits);
    show(limits);
    const title = await screen.findByRole("button", { name: /Portfolio/ });
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull(); // no ✕ until editing
    expect(screen.queryByText("2 of 10 coins")).toBeNull();
    fireEvent.click(title);
    expect(screen.getByRole("menuitem", { name: /Memes/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "New list" }));
    fireEvent.change(screen.getByLabelText("New watchlist name"), { target: { value: "Alts" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(posts(fetch, "/watchlists")).toHaveLength(1));
    expect(JSON.parse(String(posts(fetch, "/watchlists")[0]?.[1]?.body))).toEqual({ name: "Alts" });
    expect(await screen.findByRole("button", { name: /Alts/ })).toBeTruthy();
  });

  it("analyses every coin in the list, one after another", async () => {
    const fetch = serve(limits);
    show(limits);
    await screen.findByRole("button", { name: /Portfolio/ });
    fireEvent.click(screen.getByRole("button", { name: "Analyse all" }));
    await waitFor(() => expect(posts(fetch, "/signal").length).toBeGreaterThanOrEqual(2));
    const coins = posts(fetch, "/signal").map(
      ([, init]) => JSON.parse(String(init?.body)) as { coin: string; force: boolean },
    );
    expect(coins.every((c) => c.force)).toBe(true);
    expect(await screen.findByRole("button", { name: "Analyse all" })).toBeTruthy();
  });

  it("resizes the watchlist by drag or keys, within limits, and remembers it", async () => {
    window.localStorage.removeItem("desk.trade.watchlist");
    serve(limits);
    show(limits);
    const grip = await screen.findByRole("button", { name: /^Resize watchlist/ });
    const main = grip.parentElement as HTMLElement;
    fireEvent.pointerDown(grip, { clientX: 260, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 340, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(main.style.getPropertyValue("--col-left")).toBe("340px");
    fireEvent.keyDown(grip, { key: "ArrowLeft" });
    expect(main.style.getPropertyValue("--col-left")).toBe("324px");
    fireEvent.pointerDown(grip, { clientX: 324, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 2000, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(grip.getAttribute("data-size")).toBe("480"); // the most it widens
    expect(window.localStorage.getItem("desk.trade.watchlist")).toBe("480");
    fireEvent.doubleClick(grip);
    expect(main.style.getPropertyValue("--col-left")).toBe("260px");
  });

  it("resizes the chart's height by drag, and remembers it", async () => {
    window.localStorage.removeItem("desk.trade.chartHeight");
    serve(limits);
    show(limits);
    const grip = await screen.findByRole("button", { name: /^Resize chart height/ });
    const box = grip.parentElement as HTMLElement;
    fireEvent.pointerDown(grip, { clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(box.style.getPropertyValue("--chart-height")).toBe("460px");
    fireEvent.keyDown(grip, { key: "ArrowDown" });
    expect(window.localStorage.getItem("desk.trade.chartHeight")).toBe("476");
    fireEvent.doubleClick(grip);
    expect(box.style.getPropertyValue("--chart-height")).toBe("560px");
  });

  it("shows only the levels that matter for an entry, around the price", async () => {
    serve(limits);
    show(limits);
    const ladder = await screen.findByRole("list", { name: "Key levels" });
    const items = Array.from(ladder.querySelectorAll("li")).map((li) => li.className);
    const now = items.indexOf("now");
    expect(now).toBeGreaterThanOrEqual(0);
    expect(items.slice(0, now).every((c) => c === "above")).toBe(true);
    expect(items.slice(now + 1).every((c) => c === "below")).toBe(true);
    expect(ladder.textContent).toContain("Week open");
    expect(ladder.textContent).toContain("Day open");
    expect(ladder.textContent).not.toContain("Month open"); // 12% away: not what an entry needs
  });

  it("puts the smart trade under the chart", async () => {
    serve(limits);
    show(limits);
    const order = await screen.findByRole("region", { name: "Order form" });
    const chart = screen.getByRole("region", { name: "Chart and analysis" });
    expect(chart.compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
