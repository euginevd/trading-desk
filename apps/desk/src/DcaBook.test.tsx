import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DcaBookPage from "./DcaBookPage";
import DcaWidget from "./DcaWidget";
import { toCsv } from "./dcaFormat";
import type { DcaBook, DcaOrder, DcaWeekPlan } from "./types";

// Made-up figures only (known-mistakes 7).
const START = Date.UTC(2026, 10, 20, 6, 0); // Fri 20 Nov, 5pm Sydney
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
      closeOut: START + 3 * 86_400_000 + 2 * 3_600_000,
      orders: [order({}), filledEth],
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

function serve(reply: DcaBook) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "");
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (path === "/dca") return json(reply);
    if (path === "/dca/suggest") return json(plan);
    if (path === "/dca/close-out") return json({ closed: ["BTC 49.79"] });
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
  it("says the week in a sentence, shows its orders and closes out after asking", async () => {
    const fetch = serve(book());
    render(<DcaWidget now={START + 4 * 86_400_000} />);
    expect(await screen.findByText("This week's 70.00 USDC: 1 of 2 limits filled.")).toBeTruthy();
    expect(screen.getByText("20 Nov (Fri) 5pm")).toBeTruthy(); // deposit day, dated
    expect(screen.getByText("23 Nov (Mon) 7pm")).toBeTruthy(); // the close-out
    const table = screen.getByRole("table", { name: "This week's orders" });
    expect(within(table).getByText("63,837.40")).toBeTruthy();
    expect(within(table).getByText("Filled")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close out now" }));
    expect(sent(fetch, "/dca/close-out")).toHaveLength(0); // the confirm first
    fireEvent.click(screen.getByRole("button", { name: "Buy the rest at market" }));
    await waitFor(() => expect(sent(fetch, "/dca/close-out")).toHaveLength(1));
    expect(await screen.findByText("Bought at market: BTC 49.79.")).toBeTruthy();
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
    expect(within(positions).getByText(/DCA-ETH, since/)).toBeTruthy();
    expect(within(positions).getByText(/DCA-BTC, nothing bought yet/)).toBeTruthy();
    const orders = screen.getByRole("table", { name: "Every order" });
    expect(within(orders).getByText("DCA-ETH-26W47-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ETH" }));
    expect(
      within(screen.getByRole("table", { name: "Every order" })).queryByText("DCA-BTC-26W47-1"),
    ).toBeNull();
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
