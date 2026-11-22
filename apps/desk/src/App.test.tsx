import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App, { dominanceMove } from "./App";
import { amount, amountSleek, percent, price, priceSleek, usd, usdShort, usdWhole } from "./format";
import type { Portfolio, Settings } from "./types";

const settings: Settings = {
  tradingOn: true,
  perOrder: "100",
  perDay: "500",
  spentToday: "0",
  leftToday: "500",
};

const portfolio: Portfolio = {
  fetchedAt: "2026-11-13T03:32:05+00:00",
  demo: true,
  total: {
    value: "42585",
    aud: "62762.97",
    audRate: "1.4738",
    rates: { USD: "1", AUD: "1.4738", INR: "84.21", BTC: "0.00001" },
    audDate: "2026-11-13",
    change24h: "1500",
    change24hPercent: "3.65",
    profit: "130",
    profitPercent: "8.81",
    cost: "1475",
  },
  holdings: [
    {
      asset: "PEPE",
      source: "Binance",
      amount: "12345.678901",
      price: "0.0000101",
      value: "0.12",
      change24h: "1",
      share: "0",
      averageCost: null,
      covered: null,
      profit: null,
      profitPercent: null,
    },
    {
      asset: "NEAR",
      source: "Binance",
      amount: "2.34567891",
      price: "3.35",
      value: "7.86",
      change24h: "1.5",
      share: "0.02",
      averageCost: null,
      covered: null,
      profit: null,
      profitPercent: null,
    },
    {
      asset: "TAO",
      source: "Ledger",
      amount: "97.4",
      price: "412.5",
      value: "40177.5",
      change24h: "4.8",
      share: "94.35",
      averageCost: null,
      covered: null,
      profit: null,
      profitPercent: null,
    },
    {
      asset: "BNB",
      source: "Binance",
      amount: "3.75",
      price: "642",
      value: "2407.5",
      change24h: "-0.35",
      share: "5.65",
      averageCost: "590",
      covered: "2.5",
      profit: "130",
      profitPercent: "8.81",
    },
  ],
  openOrders: [
    {
      orderId: 7,
      symbol: "SOLUSDT",
      time: 1_794_000_000_000,
      pair: "SOL/USDT",
      side: "Sell",
      type: "Limit",
      price: "240",
      amount: "2",
      filled: "0",
    },
  ],
  recentTrades: [],
  wallets: {
    binance: { status: "connected" },
    tao: { status: "connected", free: "12.4", staked: "85", total: "97.4", rewards: "1.5" },
  },
  history: [
    { day: "2026-11-12", value: "41000" },
    { day: "2026-11-13", value: "42585" },
  ],
};

type Routes = Record<string, (init?: RequestInit) => [number, unknown]>;

function serve(routes: Routes) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "").split("?")[0] ?? "";
    const route = routes[`${init?.method ?? "GET"} ${path}`];
    const [status, body] = route ? route(init) : [404, { error: "Not found." }];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const basics: Routes = {
  "GET /settings": () => [200, settings],
  "GET /tickers": () => [200, { tickers: [{ coin: "BTC", price: "98400", change24h: "2.1" }] }],
};

// The pages load lazily (decision 85): fetched once up front, so a busy test run doesn't time out
// waiting for a page's code.
beforeAll(async () => {
  await Promise.all([
    import("./Journal"),
    import("./BotsHome"),
    import("./PotPage"),
    import("./RiskPage"),
    import("./ProfilePage"),
    import("./Portfolio"),
  ]);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("desk.currency");
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("format", () => {
  it("shows money, prices, signs and coin amounts plainly", () => {
    expect(usd("84754.5")).toBe("$84,754.50");
    expect(usd("-881.4", true)).toBe("−$881.40");
    expect(usd("130", true)).toBe("+$130.00");
    expect(percent("-1.18")).toBe("−1.2%");
    expect(amount("0.00005000")).toBe("0.00005");
    expect(price("98400")).toBe("98,400.00");
    expect(price("0.0001234")).toBe("0.000123");
    expect(usd(null)).toBe("–");
    expect(usdShort("422342202.34")).toBe("$422.3M");
    expect(usdShort("950")).toBe("$950.00");
  });

  it("keeps the Dashboard table sleek: whole dollars, short prices, amounts by coin", () => {
    expect(usdWhole("65334.47")).toBe("$65,334");
    expect(usdWhole("-640.34", true)).toBe("−$640");
    expect(priceSleek("66851.99")).toBe("66,852");
    expect(priceSleek("209.5")).toBe("210");
    expect(priceSleek("75.57")).toBe("75.57");
    expect(priceSleek("0.7762")).toBe("0.776");
    expect(priceSleek("0.003388")).toBe("0.00339");
    expect(amountSleek("0.04219377", "66851.99")).toBe("0.0421"); // BTC, cut not rounded
    expect(amountSleek("1.23456", "2386")).toBe("1.23"); // ETH
    expect(amountSleek("250.12345678", "209.5")).toBe("250.1"); // TAO
    expect(amountSleek("42.0049", "75.57")).toBe("42"); // SOL
    expect(amountSleek("123456.78", "0.003388")).toBe("123,456"); // PUMP, cut
  });
});

describe("top bar", () => {
  it("works out BTC dominance's move from the market's and Bitcoin's 24h changes", () => {
    const btc = (change24h: string) => [{ coin: "BTC", price: "98400", change24h }];
    // 50% of a market flat on the day, Bitcoin up 2%: it was 50 / 1.02 = 49.02% a day ago.
    expect(dominanceMove({ btcShare: "50", capChange: "0" }, btc("2"))?.toFixed(2)).toBe("0.98");
    expect(dominanceMove({ btcShare: "50", capChange: "2" }, btc("2"))).toBe(0);
    expect(dominanceMove({ btcShare: "50" }, btc("2"))).toBeNull();
    expect(dominanceMove({ btcShare: "50", capChange: "1" }, [])).toBeNull();
  });
});

describe("side panel", () => {
  it("links Dashboard, Trade and the bots, and folds to icons", async () => {
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual([
      "Dashboard",
      "Portfolio",
      "Journal",
      "Trade",
      "Backtest",
      "Risk",
      "Tax",
      "Bots",
      "Profile",
      "Settings",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse side panel" }));
    expect(screen.getByRole("button", { name: "Expand side panel" })).toBeTruthy();
    expect(window.localStorage.getItem("desk.side.folded")).toBe("1");
    // The old Grid Bot link opens Bots on its Grid bots tab; no rebalancing for now.
    window.location.hash = "#/grid";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("heading", { level: 1, name: "Bots" })).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "Bots" });
    expect(within(tabs).getByRole("link", { name: "Grid bots" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "DCA bots" }).getAttribute("href")).toBe(
      "#/dca-book",
    );
    expect(screen.queryByText(/Rebalancing/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand side panel" }));
  });
});

describe("feature flags", () => {
  it("hides switched-off pages, and a link to one opens the Dashboard saying why", async () => {
    window.location.hash = "#/journal";
    serve({
      ...basics,
      "GET /portfolio": () => [200, portfolio],
      "GET /settings/features": () => [200, { flags: { journal: false, risk: false } }],
    });
    render(<App />);
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Journal is off, so this opened the Dashboard. Turn it on in Settings",
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual([
      "Dashboard",
      "Portfolio",
      "Trade",
      "Backtest",
      "Tax",
      "Bots",
      "Profile",
      "Settings",
    ]);
    expect(within(nav).getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.queryByRole("heading", { level: 1, name: "Journal" })).toBeNull();
  });

  it("switches a page from Settings and the side panel follows", async () => {
    window.location.hash = "#/settings";
    let flags: Record<string, boolean> = {};
    const fetch = serve({
      ...basics,
      "GET /settings/features": () => [200, { flags }],
      "PUT /settings/features": (init) => {
        const { id, on } = JSON.parse(String(init?.body)) as { id: string; on: boolean };
        flags = { ...flags, [id]: on };
        return [200, { flags }];
      },
    });
    render(<App />);
    const risk = await screen.findByRole("switch", { name: "Risk page" });
    expect(risk.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Dashboard page" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("switch", { name: "Settings page" })).toHaveProperty("disabled", true);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Risk" })).toBeTruthy();

    fireEvent.click(risk);
    await waitFor(() => expect(within(nav).queryByRole("link", { name: "Risk" })).toBeNull());
    expect(screen.getByRole("switch", { name: "Risk page" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.getByText("Your limits are still checked on every order")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "/api/settings/features",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ id: "risk", on: false }) }),
    );

    fireEvent.click(screen.getByRole("switch", { name: "Risk page" }));
    expect(await within(nav).findByRole("link", { name: "Risk" })).toBeTruthy();
  });

  it("says so when a switch isn't saved, and keeps the page as it was", async () => {
    window.location.hash = "#/settings";
    serve({
      ...basics,
      "GET /settings/features": () => [200, { flags: {} }],
      "PUT /settings/features": () => [400, { error: "Not saved." }],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("switch", { name: "Journal page" }));
    const pages = screen.getByRole("region", { name: "Pages" });
    expect(await within(pages).findByRole("alert")).toHaveProperty("textContent", "Not saved.");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Journal" })).toBeTruthy();
  });
});

describe("kill switch", () => {
  it("can switch trading off when the api wasn't up as the desk opened (audit 14)", async () => {
    const fetch = serve({
      ...basics,
      "GET /settings": () => [500, { error: "Not yet." }],
      "PUT /trading": () => [200, { ...settings, tradingOn: false, stillLive: 2 }],
    });
    render(<App />);
    const pill = await screen.findByRole("button", { name: "Trading unknown" });
    expect(pill).toHaveProperty("disabled", false);
    fireEvent.click(pill);
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1),
    );
    const put = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ on: false });
    expect(await screen.findByRole("button", { name: "Trading off" })).toBeTruthy();
    const side = screen.getByRole("complementary", { name: "Side panel" });
    expect(within(side).getByRole("alert").textContent).toBe(
      "2 buys are still live on Binance: the desk tries to cancel them every 30 seconds.",
    );
  });

  it("says so when the switch fails", async () => {
    serve({ ...basics, "PUT /trading": () => [500, { error: "The api couldn't save it." }] });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Trading on" }));
    const side = screen.getByRole("complementary", { name: "Side panel" });
    expect((await within(side).findByRole("alert")).textContent).toBe("The api couldn't save it.");
    expect(screen.getByRole("button", { name: "Trading on" })).toBeTruthy();
  });
});

describe("portfolio page", () => {
  beforeEach(() => {
    window.location.hash = "#/portfolio"; // today's content, moved off the Dashboard
  });

  it("reads the balances again when the tab comes back into view", async () => {
    const fetch = serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    expect((await screen.findAllByText("A$62,762")).length).toBeGreaterThan(0);
    const reads = () => fetch.mock.calls.filter(([url]) => url.endsWith("/portfolio")).length;
    const before = reads();
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it("shows Binance and the Ledger, the total and the value line", async () => {
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    // AUD first: 42,585 at 1.4738, exact in the header and rounded in the sentence
    expect((await screen.findAllByText("A$62,762")).length).toBeGreaterThan(0);
    // All: four widgets for the whole account (owner, 22 Nov 2026), no sentence.
    const tiles = document.querySelector('[aria-label="The whole account"]') as HTMLElement;
    expect(within(tiles).getByText("A$63K")).toBeTruthy();
    expect(within(tiles).getByText("+A$192")).toBeTruthy();
    expect(within(tiles).getByText("94%")).toBeTruthy(); // on the Ledger
    expect(within(tiles).getByText(/^A\$59K Ledger · A\$3\.\dK Binance$/)).toBeTruthy();
    expect(screen.queryByText(/τ on the Ledger/)).toBeNull(); // the TAO line is gone
    expect(screen.getByText(/^avg A\$870 · now/)).toBeTruthy(); // BNB average cost 590 in AUD
    expect(screen.queryByText(/ at 1.4738 AUD/)).toBeNull(); // the rate line is hidden
    expect(screen.queryByText("Account value")).toBeNull(); // the 30-day box is gone for now
    expect(screen.getByText(/Demo data/)).toBeTruthy();
    expect(await screen.findByText("98,400")).toBeTruthy(); // the top bar's ticker, whole dollars
    expect(screen.getByRole("button", { name: "Trading on" })).toBeTruthy();
  });

  it("hides dust under $5, and rounds holdings under $10", async () => {
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    expect((await screen.findAllByText("NEAR")).length).toBeGreaterThan(0); // $7.86: shown, not dust
    expect(screen.queryByText("PEPE")).toBeNull();
    // Allocation: the six largest coins by share; past seven, the rest share one "more" slice.
    const donut = screen.getByRole("img", { name: "Allocation by coin" });
    const arcs = Array.from(donut.querySelectorAll("circle")).map((c) =>
      c.getAttribute("aria-label"),
    );
    expect(arcs).toHaveLength(3);
    expect(arcs[0]).toMatch(/^TAO: 94%, A\$59,2\d\d$/); // 40,177.50 of 42,592.86
    expect(arcs[1]).toMatch(/^BNB: 5\.\d%/);
    expect(arcs[2]).toMatch(/^NEAR: <0\.1%/); // three coins: each its own slice
    fireEvent.mouseEnter(donut.querySelectorAll("circle")[1] as Element);
    expect(donut.textContent).toContain("BNB");
  });

  it("shows your targets beside Allocation, with the order that moves a coin back", async () => {
    serve({
      ...basics,
      "GET /portfolio": () => [200, portfolio],
      "GET /rebalance": () => [
        200,
        {
          band: "5",
          outside: 2,
          hasTargets: true,
          rows: [
            {
              coin: "TAO",
              targetPct: "60",
              nowPct: "94",
              outside: true,
              side: "sell",
              orderAud: "150",
              toTargetAud: "21000",
              price: "412.5",
              qty: "0.25",
              capped: true,
            },
            {
              coin: "BNB",
              targetPct: "40",
              nowPct: "6",
              outside: true,
              side: "buy",
              orderAud: "150",
              toTargetAud: "21000",
              price: "642",
              qty: "0.16",
              capped: true,
            },
          ],
        },
      ],
    });
    render(<App />);
    // The targets have their own box beside Allocation, with the one order that moves a coin back.
    const box = await screen.findByRole("region", { name: /^Targets/ });
    expect(await within(box).findByText("of 60%")).toBeTruthy();
    const trim = within(box).getByRole("link", { name: "Trim A$150" });
    expect(trim.getAttribute("title")).toMatch(/^A\$21K to reach the target/);
    expect(within(box).getByRole("link", { name: "Add A$150" })).toBeTruthy();
  });

  it("closes the average cost editor when focus leaves it", async () => {
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "TAO: open its details" }));
    fireEvent.click(screen.getByRole("button", { name: "Add average cost for TAO in Ledger" }));
    const input = screen.getByRole("textbox", { name: "Average cost for TAO in Ledger, in USD" });
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(screen.queryByRole("textbox", { name: /Average cost for TAO/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add average cost for TAO in Ledger" })).toBeTruthy();
  });

  it("lets the owner enter an average cost for the wallet's TAO", async () => {
    const fetch = serve({
      ...basics,
      "GET /portfolio": () => [200, portfolio],
      "PUT /cost": () => [200, { averageCost: "300" }],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "TAO: open its details" }));
    fireEvent.click(screen.getByRole("button", { name: "Add average cost for TAO in Ledger" }));
    const input = screen.getByRole("textbox", { name: "Average cost for TAO in Ledger, in USD" });
    fireEvent.change(input, { target: { value: "300.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({
        source: "Ledger",
        asset: "TAO",
        averageCost: "300.00",
      });
    });
  });

  it("filters the total and the balances to one source", async () => {
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    const filter = await screen.findByRole("group", { name: "Show holdings from" });
    expect(screen.getByTitle(/^From trades for 66%/)).toBeTruthy(); // BNB: 2.5 of 3.75
    expect(within(filter).getByRole("button", { name: "All" })).toBeTruthy(); // no counts
    fireEvent.click(within(filter).getByRole("button", { name: /^Ledger/ }));
    const ledger = () => document.querySelector('[aria-label="The Ledger"]') as HTMLElement;
    expect(within(ledger()).getByText("A$59K")).toBeTruthy(); // 40,177.50 at 1.4738
    expect(within(ledger()).getByText("85.0 τ")).toBeTruthy(); // TAO staked
    expect(screen.getAllByText("A$59,214").length).toBeGreaterThan(0); // exact in the table
    expect(screen.queryByText("BNB")).toBeNull();
    expect(screen.queryByRole("region", { name: "USDC deposits" })).toBeNull(); // Fiat: Binance's
    fireEvent.click(within(filter).getByRole("button", { name: /^Binance/ }));
    expect(screen.getAllByText("BNB").length).toBeGreaterThan(0);
    const binance = document.querySelector('[aria-label="Binance"]') as HTMLElement;
    expect(within(binance).getByText("A$3.6K")).toBeTruthy();
    expect(within(binance).getByText("+A$192")).toBeTruthy();
    // The side panel's Ledger row is a link to the same page, on the Ledger.
    const status = document.querySelector(".side-status") as HTMLElement;
    const wallet = within(status).getByRole("link", { name: /^Ledger: what your Ledger holds/ });
    expect(wallet.getAttribute("href")).toBe("#/portfolio?source=ledger");
    window.location.hash = "#/portfolio?source=ledger";
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() => expect(ledger()).toBeTruthy());
    window.location.hash = "";
  });

  it("cycles the whole Dashboard through AUD, USD, INR and BTC from the header total, and remembers it", async () => {
    window.localStorage.removeItem("desk.currency");
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    await screen.findAllByText("BNB");
    // Each click on the header total shows the next currency, round from AUD.
    const next = () => fireEvent.click(screen.getByRole("button", { name: /^Total value in / }));
    expect(screen.queryByRole("menu", { name: "Currency" })).toBeNull();
    next();
    expect(screen.getAllByText("$42,585")[0]).toBeTruthy();
    expect(screen.queryByText(/ at 1.4738 AUD/)).toBeNull();
    const tiles = document.querySelector('[aria-label="The whole account"]') as HTMLElement;
    expect(within(tiles).getByText("$43K")).toBeTruthy();
    expect(within(tiles).getByText("+$130")).toBeTruthy();
    next();
    expect(screen.getAllByText("₹35,86,083")[0]).toBeTruthy(); // 42,585 at 84.21, Indian grouping
    next();
    expect(screen.getAllByText("₿0.4259").length).toBeGreaterThan(0); // 42,585 at 0.00001
    expect(window.localStorage.getItem("desk.currency")).toBe("BTC");
    next();
    expect(window.localStorage.getItem("desk.currency")).toBe("AUD");
    window.localStorage.removeItem("desk.currency");
  });

  it("shows USDC deposits by month for the financial year, paid or estimated", async () => {
    const months = [
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
    ];
    serve({
      ...basics,
      "GET /portfolio": () => [200, portfolio],
      "GET /deposits": () => [
        200,
        {
          fy: "2026-27",
          from: "2026-07-01",
          to: "2027-06-30",
          coin: "USDC",
          total: { usdc: "1390.5", aud: "2048.8", audPerUsdc: "1.4734", paid: 1, estimated: 1 },
          months: months.map((label, i) => ({
            month: `${i < 6 ? 2026 : 2027}-${String(((i + 6) % 12) + 1).padStart(2, "0")}`,
            label,
            usdc: i === 1 ? "1390.5" : "0",
            aud: i === 1 ? "2048.8" : "0",
            count: i === 1 ? 2 : 0,
          })),
          deposits: [
            {
              time: 2,
              day: "2026-08-08",
              amount: "690",
              network: "BASE",
              aud: "1048.8",
              basis: "estimate",
              rate: "1.52",
            },
            {
              time: 1,
              day: "2026-08-03",
              amount: "700.5",
              network: "BASE",
              aud: "1000",
              basis: "paid",
              rate: "1.5",
            },
          ],
        },
      ],
    });
    render(<App />);
    // Fiat is Binance's: it shows on the Binance tab (owner, 22 Nov 2026).
    const filter = await screen.findByRole("group", { name: "Show holdings from" });
    fireEvent.click(within(filter).getByRole("button", { name: /^Binance/ }));
    const card = await screen.findByRole("region", { name: "USDC deposits" });
    await within(card).findByText("FY 2026-27");
    expect(within(card).getAllByText("A$2K")).toHaveLength(3); // the year, over August's bar, the line
    const bars = within(card).getByRole("group", { name: "Deposits by month" });
    expect(within(bars).getAllByRole("button")).toHaveLength(12);
    const aug = within(bars).getByRole("button", { name: /^Aug: A\$2K from 2 deposits/ });
    expect(aug.getAttribute("aria-pressed")).toBe("true"); // the latest month with deposits
    expect(within(card).getByText(/from 2 deposits, 1 estimated\./)).toBeTruthy();
    expect(within(card).queryByRole("list", { name: "Deposits in Aug" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "See them" }));
    const list = within(card).getByRole("list", { name: "Deposits in Aug" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("690 USDC")).toBeTruthy(); // newest first
    expect(within(list).getByText("701 USDC")).toBeTruthy(); // whole numbers: 700.5 rounds up
    expect(within(list).getAllByText("A$1K")).toHaveLength(2); // A$1,048.80 and A$1,000
    expect(within(list).queryByRole("button", { name: /more/ })).toBeNull(); // 5 or fewer
  });

  it("sorts the balances by coin, holding or 24h", async () => {
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    const order = () =>
      Array.from(document.querySelectorAll("tbody tr td:first-child .coin")).map(
        (c) => c.textContent,
      );
    await screen.findByRole("button", { name: /^24h/ });
    expect(order().slice(0, 3)).toEqual(["TAO", "BNB", "NEAR"]); // by value, high first
    fireEvent.click(screen.getByRole("button", { name: /^24h/ }));
    expect(order().slice(0, 3)).toEqual(["TAO", "NEAR", "BNB"]); // 4.8, 1.5, −0.35
    fireEvent.click(screen.getByRole("button", { name: /^24h/ }));
    expect(order()[0]).toBe("BNB"); // low first
    expect(screen.queryByRole("button", { name: /^Amount/ })).toBeNull(); // amount sits under the coin
    // Invested: BNB's 2.5 covered at 590 = 1,475 (A$2,174); total value of what's shown
    const foot = document.querySelector("tfoot tr") as HTMLElement;
    expect(within(foot).getByText("Total")).toBeTruthy();
    expect(within(foot).getByText("A$2,174")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Coin/ }));
    expect(order().slice(0, 3)).toEqual(["BNB", "NEAR", "TAO"]); // A to Z
  });

  it("opens a holding in place: where it's held and where to act on it", async () => {
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "BNB: open its details" }));
    expect(screen.getByText("On Binance")).toBeTruthy();
    const act = screen.getByRole("link", { name: "Take profit or add funds on Trade" });
    expect(act.getAttribute("href")).toBe("#/trade"); // not a DCA coin: its book is Trade
    fireEvent.click(screen.getByRole("button", { name: "TAO: open its details" }));
    const open = document.querySelector("tr.port-open") as HTMLElement;
    expect(within(open).getByText("On the Ledger")).toBeTruthy();
    expect(within(open).getByText(/send it to Binance first/)).toBeTruthy();
    expect(within(open).queryByText("On Binance")).toBeNull(); // one row open at a time
  });

  it("refreshes from an icon, with no connect buttons", async () => {
    serve({ ...basics, "GET /portfolio": () => [200, portfolio] });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect exchange" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add wallet" })).toBeNull();
  });

  it("asks before cancelling an open order, then cancels it", async () => {
    const fetch = serve({
      ...basics,
      "GET /portfolio": () => [200, portfolio],
      "POST /orders/cancel": () => [200, { message: "Cancelled." }],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Open orders (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Cancel your sell of 2 SOL at 240.00?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep order" })); // a slip: nothing sent
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    await waitFor(() => {
      const posts = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({ symbol: "SOLUSDT", orderId: 7 });
    });
  });

  it("shows the api's error with a way to try again", async () => {
    serve({
      ...basics,
      "GET /portfolio": () => [
        503,
        { error: "Add BINANCE_API_KEY and BINANCE_API_SECRET to .env." },
      ],
    });
    render(<App />);
    expect(await screen.findByText(/BINANCE_API_KEY/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText("Binance disconnected")).toBeTruthy();
  });

  it("says when the api isn't running", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    render(<App />);
    expect((await screen.findAllByText(/api isn't running/)).length).toBeGreaterThan(0);
  });
});

describe("widget details", () => {
  beforeEach(() => {
    window.location.hash = "#/portfolio"; // today's content, moved off the Dashboard
  });

  it("opens Fear & Greed's details from the top bar", async () => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    const day = { value: 17, label: "Extreme Fear", day: 1_794_000_000_000 };
    serve({
      ...basics,
      "GET /portfolio": () => [200, portfolio],
      "GET /sentiment": () => [
        200,
        { value: 17, label: "Extreme Fear", yesterday: 18, updated: 1 },
      ],
      "GET /sentiment/detail": () => [
        200,
        {
          now: day,
          history: { lastWeek: { ...day, value: 32, label: "Fear" } },
          high: { ...day, value: 82, label: "Extreme Greed" },
          low: { ...day, value: 5 },
          summary: "The index has moved from Neutral a month ago to Extreme Fear today.",
          chart: [],
          market: {
            cap: "2268170000000",
            capChange: "-2.79",
            volume: "73870000000",
            btcShare: "57",
          },
        },
      ],
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Fear & Greed 17, Extreme Fear: details" }),
    );
    expect(await screen.findByText(/from Neutral a month ago/)).toBeTruthy();
    expect(screen.getByText("Last week")).toBeTruthy();
    expect(screen.getByRole("img", { name: "17, Extreme Fear" })).toBeTruthy();
    expect(screen.getByText("$73.9B")).toBeTruthy(); // volume; the cap is in the top bar
  });

  it("opens an open order on its chart, says how far it is, and changes it in one step", async () => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    const edits: unknown[] = [];
    serve({
      ...basics,
      "GET /portfolio": () => [200, portfolio],
      "GET /market": () => [
        200,
        {
          symbol: "SOLUSDT",
          coin: "SOL",
          pair: "SOL/USDT",
          quote: "USDT",
          interval: "1h",
          price: "200",
          change24h: "1",
          high24h: null,
          low24h: null,
          volume24h: null,
          candles: [
            { t: 1, o: "198", h: "201", l: "197", c: "199", v: "1" },
            { t: 2, o: "199", h: "202", l: "198", c: "200", v: "1" },
          ],
          indicators: {
            rsi: null,
            sma20: null,
            sma50: null,
            support: null,
            resistance: null,
            trend: "",
          },
        },
      ],
      "POST /orders/edit": (init) => {
        edits.push(JSON.parse(String(init?.body)));
        return [200, { message: "Order changed: sell 2 SOL/USDT at 230.", orderId: 8 }];
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /Open orders/ }));
    fireEvent.click(screen.getByRole("button", { name: "SOL/USDT" }));
    expect(await screen.findByText("Fills if the price rises 20.0% to 240.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Limit price"), { target: { value: "230" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toMatchObject({ symbol: "SOLUSDT", orderId: 7, price: "230", amount: "2" });
  });
});
