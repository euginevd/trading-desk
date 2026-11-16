import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DcaBookPage from "./DcaBookPage";
import DcaWidget from "./DcaWidget";
import { toCsv } from "./dcaFormat";
import type { DcaBook, DcaOrder, DcaWeekPlan, FundsPlan } from "./types";

// Made-up figures only (known-mistakes 7).
const START = Date.UTC(2026, 10, 20, 8, 0); // Fri 20 Nov, 7pm Sydney
const order = (o: Partial<DcaOrder>): DcaOrder => ({
  ref: "DCA-BTC-26W47-1",
  coin: "BTC",
  side: "buy",
  kind: "limit",
  source: "weekly",
  link: null,
  week: "26W47",
  price: "63837.4",
  qty: "0.00078",
  spend: "49.79",
  status: "open",
  filledQty: "0",
  filledQuote: "0",
  avgPrice: null,
  fee: "0",
  created: START + 3_600_000,
  updated: START + 3_600_000,
  ...o,
});

const filledEth = order({
  ref: "DCA-ETH-26W47-1",
  coin: "ETH",
  price: "1772.37",
  qty: "0.0112",
  spend: "19.85",
  status: "filled",
  filledQty: "0.0112",
  filledQuote: "19.85",
  avgPrice: "1772.37",
  fee: "0.02",
});

function book(over: Partial<DcaBook> = {}): DcaBook {
  return {
    quote: "USDC",
    rate: "1.47",
    plan: {
      start: "2026-11-16",
      weeks: 156,
      orders: [
        { coin: "BTC", spend: "50", odds: 70 },
        { coin: "ETH", spend: "20", odds: 60 },
      ],
    },
    positions: [
      {
        coin: "BTC",
        id: "DCA-BTC",
        since: null,
        qty: "0",
        avgCost: null,
        avgCostAud: null,
        added: "0",
        price: "64000",
        value: "0",
        pnl: "0",
        pnlPct: null,
        realised: "0",
        fees: "0",
      },
      {
        coin: "ETH",
        id: "DCA-ETH",
        since: START + 7_200_000,
        qty: "0.0112",
        avgCost: "1772.37",
        avgCostAud: "2605.38",
        added: "19.85",
        price: "1800",
        value: "20.16",
        pnl: "0.31",
        pnlPct: "1.56",
        realised: "0",
        fees: "0.02",
      },
    ],
    totals: {
      added: "19.85",
      value: "20.16",
      pnl: "0.31",
      pnlPct: "1.56",
      realised: "0",
      fees: "0.02",
    },
    progress: {
      week: 2,
      weeks: 156,
      weekly: "70",
      onPlan: "19.85",
      planTotal: "10920",
      ticks: [
        { week: 1, key: "26W46", friday: "2026-11-13", state: "missed", trim: false, usdc: "0" },
        { week: 2, key: "26W47", friday: "2026-11-20", state: "now", trim: false, usdc: "19.85" },
      ],
    },
    week: {
      key: "26W47",
      start: START,
      closeOut: START + 3 * 86_400_000,
      orders: [order({}), filledEth],
    },
    next: {
      key: "26W48",
      start: START + 7 * 86_400_000,
      closeOut: START + 10 * 86_400_000,
    },
    orders: [filledEth, order({})],
    priceError: null,
    ...over,
  };
}

const plan: DcaWeekPlan = {
  week: "26W47",
  closeOut: START + 3 * 86_400_000,
  quote: "USDC",
  orders: [
    {
      coin: "BTC",
      spend: "50",
      price: "63837.4",
      now: "64500",
      target: 70,
      odds: { hit: 36, weeks: 52, pct: 69, few: false },
    },
    {
      coin: "ETH",
      spend: "20",
      price: "1772.37",
      now: "1806",
      target: 60,
      odds: { hit: 29, weeks: 52, pct: 56, few: false },
    },
  ],
};

const funds: FundsPlan = {
  side: "buy",
  amount: "100",
  quote: "USDC",
  by: "dca-agent",
  note: "Most to BTC, near last week's low.",
  said: [],
  skipped: [
    {
      coin: "SOL",
      pct: "0",
      usdc: "0",
      price: "69.27",
      now: "70.9",
      qty: "0",
      odds: { hit: 1750, windows: 2190, pct: 80 },
      reason: "Under the 10 USDC minimum.",
    },
  ],
  orders: [
    {
      coin: "BTC",
      pct: "70",
      usdc: "70",
      price: "63837.4",
      now: "64500",
      qty: "0.0011",
      odds: { hit: 1750, windows: 2190, pct: 80 },
      reason: "Just above Saturday's 63.3K low.",
    },
    {
      coin: "ETH",
      pct: "30",
      usdc: "30",
      price: "1772.37",
      now: "1806",
      qty: "0.017",
      odds: { hit: 1760, windows: 2190, pct: 80 },
      reason: "Above the 1,750 shelf.",
    },
  ],
};

function serve(reply: DcaBook) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "");
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (path === "/dca") return json(reply);
    if (path === "/dca/suggest") return json(plan);
    if (path === "/dca/close-out") return json({ closed: ["BTC 49.79"] });
    if (path === "/dca/funds/analyse") return json(funds);
    if (path === "/dca/agent")
      return json({
        reply: "SOL $20 just above Saturday's low.",
        said: [],
        quote: "USDC",
        actions: [
          {
            type: "buy",
            coin: "SOL",
            ref: "",
            side: "buy",
            was: null,
            price: "69.27",
            usdc: "20",
            now: "70.9",
            odds: { hit: 1750, windows: 2190, pct: 80 },
            reason: "Above 69 and Saturday's 68.5 low.",
          },
        ],
      });
    if (path === "/dca/orders/amend")
      return json(order({ ref: "DCA-BTC-26W47-2", link: "DCA-BTC-26W47-1" }));
    if (path === "/dca/orders") {
      const body = JSON.parse(String(init?.body)) as { coin: string };
      return json(order({ ref: `DCA-${body.coin}-26W47-9`, coin: body.coin }));
    }
    return json({ error: "Not found." }, 404);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const sent = (fetch: ReturnType<typeof serve>, path: string) =>
  fetch.mock.calls.filter(([url]) => String(url) === `/api${path}`);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DCA widget", () => {
  it("shows the buying window, the coins' limits, and closes out after asking", async () => {
    const fetch = serve(book());
    render(<DcaWidget now={START + 86_400_000} />);
    expect(
      await screen.findByText(
        "1 of 2 limits filled. The rest buy at market on 23 Nov (Mon) at 7pm.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "The buying window runs from 20 Nov (Fri) 7pm to 23 Nov (Mon) 7pm.",
      }),
    ).toBeTruthy();
    const coins = screen.getByRole("list", { name: "This week's coins against their targets" });
    expect(within(coins).getByText(/^\$[0-9]+ waiting$/)).toBeTruthy();
    expect(within(coins).getByText("0.0112 ETH, +1.56%")).toBeTruthy(); // its target met: held, with P&L
    fireEvent.click(screen.getByRole("button", { name: "Close out early" }));
    expect(sent(fetch, "/dca/close-out")).toHaveLength(0); // the confirm first
    fireEvent.click(screen.getByRole("button", { name: "Buy the rest at market" }));
    await waitFor(() => expect(sent(fetch, "/dca/close-out")).toHaveLength(1));
    expect(await screen.findByText("Bought at market: BTC 49.79.")).toBeTruthy();
  });

  it("looks ahead to the next buy once the window has closed", async () => {
    const done = book();
    done.week.orders = [filledEth];
    serve(done);
    render(<DcaWidget now={START + 4 * 86_400_000} />);
    expect(
      await screen.findByText("Next buy in 3 days: $70 USDC on 27 Nov (Fri) at 7pm."),
    ).toBeTruthy();
    expect(screen.getByText("Last week: 19.85 USDC bought.")).toBeTruthy();
  });

  it("opens a coin's position and orders in a panel, on the Dashboard too", async () => {
    serve(book());
    render(<DcaWidget now={START + 86_400_000} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "ETH: open its position and orders" }),
    );
    const eth = screen.getByRole("table", { name: "ETH orders" });
    expect(within(eth).getByText("DCA-ETH-26W47-1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in the DCA book" })).toBeTruthy();
  });

  it("asks for a plan when there's none", async () => {
    serve(book({ plan: null }));
    render(<DcaWidget />);
    expect(await screen.findByRole("link", { name: "Set up the DCA book" })).toBeTruthy();
  });
});

describe("DCA book page", () => {
  it("shows the positions with their lifelong IDs and every order", async () => {
    serve(book());
    render(<DcaBookPage />);
    expect(await screen.findByText(/2 positions, week 2 of 156\. Up 1\.56%/)).toBeTruthy();
    const positions = screen.getByRole("table", { name: "Positions" });
    expect(within(positions).getByText(/DCA-ETH since/)).toBeTruthy();
    expect(within(positions).getByText(/DCA-BTC, nothing bought yet/)).toBeTruthy();
    // A position opens to its own orders.
    fireEvent.click(within(positions).getByRole("button", { name: /ETH/ }));
    const eth = screen.getByRole("table", { name: "ETH orders" });
    expect(within(eth).getByText("DCA-ETH-26W47-1")).toBeTruthy();
    expect(within(eth).queryByText("DCA-BTC-26W47-1")).toBeNull();
    // Every order sits behind Show more.
    expect(screen.queryByRole("table", { name: "Every order" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Show more/ }));
    const orders = screen.getByRole("table", { name: "Every order" });
    expect(within(orders).getByText("DCA-BTC-26W47-1")).toBeTruthy();
  });

  it("asks dca-agent in words and places its checked actions after a review", async () => {
    const fetch = serve(book());
    render(<DcaBookPage />);
    // Folded away until asked for.
    expect(screen.queryByRole("textbox", { name: "Message to dca-agent" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Ask dca-agent/ }));
    const say = screen.getByRole("textbox", { name: "Message to dca-agent" });
    fireEvent.change(say, { target: { value: "add $20 to SOL" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("SOL $20 just above Saturday's low.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Place 1" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/dca/orders")[0]?.[1]?.body))).toEqual({
      coin: "SOL",
      spend: "20",
      price: "69.27",
      source: "named",
    });
    // Folding it away keeps the conversation.
    fireEvent.click(screen.getByRole("button", { name: "Fold dca-agent away" }));
    fireEvent.click(screen.getByRole("button", { name: /Ask dca-agent/ }));
    expect(screen.getByText("SOL $20 just above Saturday's low.")).toBeTruthy();
  });

  it("plans the week from the desk's odds and places after a review", async () => {
    const fetch = serve(book());
    render(<DcaBookPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Plan this week's orders" }));
    expect(await screen.findByText("69% (36 of 52)")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Place ETH" }));
    fireEvent.click(screen.getByRole("button", { name: "Review 1 limit" }));
    fireEvent.click(screen.getByRole("button", { name: "Place 1 limit" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/dca/orders")[0]?.[1]?.body))).toEqual({
      coin: "BTC",
      spend: "50",
      price: "63837.4",
      source: "weekly",
      override: false,
    });
  });

  it("adds funds: dca-agent's split, a hand edit, then one limit per coin", async () => {
    const fetch = serve(book());
    render(<DcaBookPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add funds" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Amount in USDC" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyse with dca-agent" }));
    expect(await screen.findByText("Most to BTC, near last week's low.")).toBeTruthy();
    expect(screen.getByText("Just above Saturday's 63.3K low.")).toBeTruthy();
    // A coin left out still shows, with why, and stays out of the orders until given a share.
    expect(screen.getByText("Under the 10 USDC minimum.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "SOL amount" })).toHaveProperty("value", "");
    fireEvent.change(screen.getByRole("textbox", { name: "BTC share" }), {
      target: { value: "60" },
    });
    expect(screen.getByRole("textbox", { name: "BTC amount" })).toHaveProperty("value", "60.00");
    fireEvent.change(screen.getByRole("textbox", { name: "ETH share" }), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review 2 limit buys" }));
    fireEvent.click(screen.getByRole("button", { name: "Place 2" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders")).toHaveLength(2));
    expect(JSON.parse(String(sent(fetch, "/dca/orders")[0]?.[1]?.body))).toEqual({
      coin: "BTC",
      spend: "60.00",
      price: "63837.4",
      source: "named",
      override: false,
    });
  });

  it("changes an open order by hand, linked to the one it replaces", async () => {
    const fetch = serve(book());
    render(<DcaBookPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Change by hand" }));
    fireEvent.change(screen.getByRole("textbox", { name: "DCA-BTC-26W47-1 new limit" }), {
      target: { value: "63500.37" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review 1 change" }));
    fireEvent.click(screen.getByRole("button", { name: "Change 1" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders/amend")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/dca/orders/amend")[0]?.[1]?.body))).toEqual({
      ref: "DCA-BTC-26W47-1",
      price: "63500.37",
      spend: "49.79",
    });
    expect(await screen.findByText("Now DCA-BTC-26W47-2")).toBeTruthy();
  });

  it("starts with the plan form when there's no plan", async () => {
    serve(book({ plan: null, progress: null }));
    render(<DcaBookPage />);
    expect(await screen.findByRole("form", { name: "Weekly plan" })).toBeTruthy();
  });
});

describe("CSV", () => {
  it("guards commas and formulas", () => {
    const csv = toCsv([order({ ref: "=HACK", link: "a,b" })], "USDC");
    expect(csv.split("\n")[1]).toContain('"=HACK"');
    expect(csv).toContain('"a,b"');
  });
});
