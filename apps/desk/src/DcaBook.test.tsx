import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DcaBookPage from "./DcaBookPage";
import DcaOrderDrawer, { since } from "./DcaOrderDrawer";
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
      state: {
        week: "26W47",
        planned: "70",
        bought: "19.85",
        waiting: "49.79",
        toPlace: "0",
        open: [
          {
            ref: "DCA-BTC-26W47-1",
            coin: "BTC",
            price: "63837.4",
            left: "49.79",
            week: "26W47",
            carried: false,
          },
        ],
        toPlaceByCoin: {},
        weekly: "70",
        weeks: 1,
        plannedByCoin: { BTC: "49.79", ETH: "20.21" },
        boughtByCoin: { ETH: "19.85" },
        waitingByCoin: { BTC: "49.79" },
        free: "100",
        needsDeposit: "0",
        skipped: false,
      },
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
    if (path === "/dca/close-out") return json({ closed: ["BTC 49.79"], missed: [] });
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
    if (path === "/dca/orders/cancel") return json(order({ status: "cancelled" }));
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

// A coin's orders live in its panel (owner, 21 Nov 2026): open its row, then Orders.
async function ordersOf(coin: string): Promise<HTMLElement> {
  const positions = await screen.findByRole("table", { name: "Positions" });
  fireEvent.click(within(positions).getByRole("button", { name: (name) => name.startsWith(coin) }));
  fireEvent.click(screen.getByRole("button", { name: /^Orders/ }));
  return screen.getByRole("dialog");
}

// Add and Remove funds for the whole book open from their link (the Dashboard's).
function atFunds(side: "add" | "remove"): void {
  window.location.hash = `#/dca-book?funds=${side}`;
}

afterEach(() => {
  window.location.hash = "";
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("DCA widget", () => {
  it("shows the buying window, the coins' limits, and closes out after asking", async () => {
    const fetch = serve(book());
    render(<DcaWidget now={START + 86_400_000} />);
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === "P" && el.textContent === "$20 of $70 bought",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: /^19\.85 bought, 49\.79 in open limits, [0-9.]+ with no order yet, of [0-9]+ USDC planned to date\.$/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "The buying window runs from 20 Nov (Fri) 7pm to 23 Nov (Mon) 7pm.",
      }),
    ).toBeTruthy();
    const coins = screen.getByRole("list", {
      name: "The plan's coins against their plan to date",
    });
    expect(within(coins).getByText(/^\$[0-9]+ limit at/)).toBeTruthy();
    // ETH's target met: Done, what's held, with its P&L.
    expect(within(coins).getByText("Done")).toBeTruthy();
    expect(within(coins).getByText("0.0112 ETH")).toBeTruthy();
    expect(within(coins).getByText("+1.56%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Buy everything now" }));
    expect(sent(fetch, "/dca/close-out")).toHaveLength(0); // the confirm first
    fireEvent.click(screen.getByRole("button", { name: "Buy now" }));
    await waitFor(() => expect(sent(fetch, "/dca/close-out")).toHaveLength(1));
    // The week it was shown, so a confirm after 7pm Monday can't buy next week's plan.
    expect(JSON.parse(String(sent(fetch, "/dca/close-out")[0]?.[1]?.body))).toEqual({
      week: "26W47",
    });
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
    expect(screen.getByText("Last week: $20 bought.")).toBeTruthy();
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

  it("lists a coin's open orders first, and every order under All", async () => {
    serve(book({ orders: [order({}), order({ ref: "DCA-BTC-26W47-2", status: "filled" })] }));
    render(<DcaWidget now={START + 86_400_000} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "BTC: open its position and orders" }),
    );
    const show = screen.getByRole("group", { name: "Show orders" });
    expect(within(show).getByRole("button", { name: "Open 1" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByText("DCA-BTC-26W47-2")).toBeNull();
    fireEvent.click(within(show).getByRole("button", { name: "All 2" }));
    expect(screen.getByText("DCA-BTC-26W47-2")).toBeTruthy();
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
    const positions = await screen.findByRole("table", { name: "Positions" });
    expect(within(positions).getByRole("button", { name: /^ETH/ })).toBeTruthy();
    // A position opens in place, then its Orders panel holds every order of that coin.
    window.localStorage.clear();
    await ordersOf("ETH");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Filled/ }));
    const orders = within(screen.getByRole("dialog")).getByRole("table", { name: "Orders" });
    expect(within(orders).getByText(/DCA-ETH-26W47-1/)).toBeTruthy();
    expect(within(orders).queryByText(/DCA-BTC-26W47-1/)).toBeNull(); // ETH's alone
    window.localStorage.clear();
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

  it("opens Weekly DCA as Add funds with the week's amount, its buys kept as the plan's", async () => {
    const fetch = serve(book());
    render(<DcaBookPage />);
    expect(screen.queryByRole("button", { name: "Plan this week's orders" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Buy this week" }));
    expect(screen.getByRole("heading", { name: "Weekly DCA" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Amount in USDC" })).toHaveProperty("value", "70");
    fireEvent.click(screen.getByRole("button", { name: "Plan it" }));
    expect(await screen.findByText("Most to BTC, near last week's low.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review \d limit/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Place \d/ }));
    await waitFor(() => expect(sent(fetch, "/dca/orders").length).toBeGreaterThan(0));
    expect(JSON.parse(String(sent(fetch, "/dca/orders")[0]?.[1]?.body))).toMatchObject({
      source: "weekly",
    });
  });

  it("keeps Add and Remove fixed while a plan is coming, and places it as it was planned", async () => {
    const fetch = serve(book());
    atFunds("add");
    render(<DcaBookPage />);
    await screen.findByRole("heading", { name: "Add funds" });
    fireEvent.change(screen.getByRole("textbox", { name: "Amount in USDC" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan it" }));
    // Audit 12: switched mid-plan, a buy plan would have gone out as sells.
    expect(screen.getByRole("button", { name: "Remove" })).toHaveProperty("disabled", true);
    expect(await screen.findByText("Most to BTC, near last week's low.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review \d limit/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Place \d/ }));
    await waitFor(() => expect(sent(fetch, "/dca/orders").length).toBeGreaterThan(0));
    for (const [, init] of sent(fetch, "/dca/orders"))
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("side", "sell");
  });

  it("overrides only the order a rule held, and stops when the confirm closes (audit 16)", async () => {
    const fetch = serve(book());
    const answer = fetch.getMockImplementation();
    let calls = 0;
    let release: (() => void) | null = null;
    fetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/dca/orders") {
        calls += 1;
        if (calls === 1) {
          const held = { error: "This buy breaks your rule: Per-trade size.", ruleBreaks: [{}] };
          return Promise.resolve(new Response(JSON.stringify(held), { status: 409 }));
        }
        if (calls === 4) {
          // the second batch's first order: answered only once the confirm has closed
          return new Promise<Response>((done) => {
            release = () => done(new Response(JSON.stringify(order({})), { status: 200 }));
          });
        }
      }
      if (!answer) throw new Error("No fetch.");
      return answer(url, init);
    });
    atFunds("add");
    render(<DcaBookPage />);
    await screen.findByRole("heading", { name: "Add funds" });
    fireEvent.change(screen.getByRole("textbox", { name: "Amount in USDC" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan it" }));
    expect(await screen.findByText("Most to BTC, near last week's low.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review \d limit/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Place \d/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Place anyway (logged)" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders")).toHaveLength(3));
    const bodies = sent(fetch, "/dca/orders").map(
      ([, init]) => JSON.parse(String(init?.body)) as { override: boolean },
    );
    expect(bodies.map((b) => b.override)).toEqual([false, true, false]); // the held one alone

    // A second plan, its confirm closed while the first order is on its way: no second order.
    fireEvent.click(screen.getByRole("button", { name: "Plan again" }));
    expect(await screen.findByRole("button", { name: /^Review \d limit/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review \d limit/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Place \d/ }));
    await waitFor(() => expect(calls).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    (release as (() => void) | null)?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Review \d limit/ })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(sent(fetch, "/dca/orders")).toHaveLength(4);
  });

  it("adds funds: the desk's split, a tick and a hand edit, then one limit per coin", async () => {
    const fetch = serve(book());
    atFunds("add");
    render(<DcaBookPage />);
    await screen.findByRole("heading", { name: "Add funds" });
    fireEvent.change(screen.getByRole("textbox", { name: "Amount in USDC" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan it" }));
    expect(await screen.findByText("Most to BTC, near last week's low.")).toBeTruthy();
    expect(JSON.parse(String(sent(fetch, "/dca/funds/analyse")[0]?.[1]?.body))).toMatchObject({
      agent: false,
    });
    // A coin left out still shows, unticked, with why.
    expect(screen.getByText("Under the 10 USDC minimum.")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Place SOL" })).toHaveProperty("checked", false);
    expect(screen.getByRole("textbox", { name: "SOL amount" })).toHaveProperty("value", "");
    fireEvent.change(screen.getByRole("textbox", { name: "BTC amount" }), {
      target: { value: "60.00" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "ETH amount" }), {
      target: { value: "40" },
    });
    // dca-agent's chat opens only when asked.
    expect(screen.queryByRole("textbox", { name: "Ask dca-agent about this split" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask dca-agent to adjust" }));
    expect(screen.getByRole("textbox", { name: "Ask dca-agent about this split" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review 2 limits" }));
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

  it("modifies an open order's price and amount from its panel", async () => {
    const fetch = serve(book());
    render(<DcaBookPage />);
    await ordersOf("BTC");
    fireEvent.click(screen.getByRole("button", { name: "Actions for DCA-BTC-26W47-1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Modify" }));
    fireEvent.change(screen.getByLabelText("Limit price"), { target: { value: "63500.37" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders/amend")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/dca/orders/amend")[0]?.[1]?.body))).toEqual({
      ref: "DCA-BTC-26W47-1",
      price: "63500.37",
      spend: "40",
      raise: false, // less than what's left: never more than the order had
    });
    expect(
      await screen.findByText("DCA-BTC-26W47-1 cancelled; now DCA-BTC-26W47-2 at 63,837.40."),
    ).toBeTruthy();
  });

  it("lets a raise a Profile rule held go once confirmed, logged", async () => {
    const fetch = serve(book());
    const answer = fetch.getMockImplementation();
    fetch.mockImplementation((url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { override?: boolean };
      if (url === "/api/dca/orders/amend" && !body.override) {
        const held = { error: "This buy breaks your rule: Per-trade size.", ruleBreaks: [{}] };
        return Promise.resolve(new Response(JSON.stringify(held), { status: 409 }));
      }
      if (!answer) throw new Error("No fetch.");
      return answer(url, init);
    });
    const props = {
      book: book(),
      editing: true,
      onClose: () => undefined,
      onCancel: () => undefined,
      onOpen: () => undefined,
      onDone: () => undefined,
    };
    render(<DcaOrderDrawer {...props} order={order({})} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Place anyway (logged)" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders/amend")).toHaveLength(2));
    expect(JSON.parse(String(sent(fetch, "/dca/orders/amend")[1]?.[1]?.body))).toMatchObject({
      spend: "90",
      raise: true,
      override: true,
    });
  });

  it("never buys again what filled while Modify was open (audit 11)", async () => {
    const fetch = serve(book());
    const props = {
      book: book(),
      editing: true,
      onClose: () => undefined,
      onCancel: () => undefined,
      onOpen: () => undefined,
      onDone: () => undefined,
    };
    const { rerender } = render(<DcaOrderDrawer {...props} order={order({})} />);
    // The 30-second reload brings a part fill: $20 of the $49.79 bought while the drawer is open.
    rerender(
      <DcaOrderDrawer {...props} order={order({ filledQty: "0.0003", filledQuote: "20" })} />,
    );
    fireEvent.change(screen.getByLabelText("Limit price"), { target: { value: "63500.37" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders/amend")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/dca/orders/amend")[0]?.[1]?.body))).toEqual({
      ref: "DCA-BTC-26W47-1",
      price: "63500.37", // no amount, no raise: the api keeps what's left now
    });
  });

  it("shows a trim before it sells, and Enter only reviews it (audit 13)", async () => {
    const fetch = serve(book());
    render(<DcaBookPage />);
    await ordersOf("ETH");
    fireEvent.click(screen.getByRole("button", { name: "Trim ETH" }));
    const sheet = screen.getByRole("dialog", { name: "Trim ETH" });
    const quantity = within(sheet).getByLabelText("Quantity (ETH)");
    fireEvent.change(within(sheet).getByLabelText("Price (USDC)"), { target: { value: "2000" } });
    fireEvent.change(quantity, { target: { value: "0.005" } });
    fireEvent.submit(quantity); // Enter in a field
    expect(within(sheet).getByRole("status").textContent).toBe(
      "Sell 0.005 ETH at 2000, about 10.00 USDC.",
    );
    expect(quantity.matches(":disabled")).toBe(true); // locked inside its fieldset
    expect(sent(fetch, "/dca/orders")).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole("button", { name: "Sell ETH" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/dca/orders")[0]?.[1]?.body))).toMatchObject({
      coin: "ETH",
      side: "sell",
      qty: "0.005",
      price: "2000",
    });
  });

  it("measures a fill's move since against its fill price (audit 17)", () => {
    expect(since(100, 200)).toBe(100); // doubled: +100%, not +50%
    expect(since(200, 100)).toBe(-50);
    expect(since(0, 100)).toBeNull();
  });

  it("opens the Tax tab's rebalance as a trim filled in, for review (audit 17)", async () => {
    window.location.hash = "#/dca-book?coin=ETH&rebalance=sell&price=2000&qty=0.005";
    const fetch = serve(book());
    render(<DcaBookPage />);
    const sheet = await screen.findByRole("dialog", { name: "Trim ETH" });
    expect(within(sheet).getByLabelText("Quantity (ETH)")).toHaveProperty("value", "0.005");
    expect(within(sheet).getByLabelText("Price (USDC)")).toHaveProperty("value", "2000");
    expect(sent(fetch, "/dca/orders")).toHaveLength(0); // nothing sent until reviewed and placed
    window.location.hash = "";
  });

  it("says where to rebalance a coin the book doesn't hold", async () => {
    window.location.hash = "#/dca-book?coin=TAO&rebalance=sell&price=410&qty=0.813";
    serve(book());
    render(<DcaBookPage />);
    expect(
      await screen.findByText(
        "TAO isn't held in the DCA book, so rebalance it where it's held: sell 0.813 at 410.",
      ),
    ).toBeTruthy();
    window.location.hash = "";
  });

  it("asks before cancelling, and says what happens to the reference and the money", async () => {
    const fetch = serve(book());
    render(<DcaBookPage />);
    await ordersOf("BTC");
    fireEvent.click(screen.getByRole("button", { name: "Actions for DCA-BTC-26W47-1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel" }));
    const ask = screen.getByRole("dialog", { name: /^Cancel DCA-BTC-26W47-1/ });
    expect(ask.textContent).toContain("$49.79 USDC is free to spend again");
    expect(ask.textContent).toContain("never reused");
    expect(ask.textContent).toContain("shows as not placed yet at Monday's close-out");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep order" }));
    expect(sent(fetch, "/dca/orders/cancel")).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select DCA-BTC-26W47-1" }));
    const bar = screen.getByRole("region", { name: "Selected orders" });
    fireEvent.click(within(bar).getByRole("button", { name: "Cancel 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders/cancel")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/dca/orders/cancel")[0]?.[1]?.body))).toEqual({
      ref: "DCA-BTC-26W47-1",
    });
    expect(await screen.findByText("1 open order cancelled.")).toBeTruthy();
  });

  it("filters a coin's orders by state and week, remembered, and opens one on its chart", async () => {
    const dropped = order({ ref: "DCA-BTC-26W47-3", status: "cancelled" });
    const old = order({
      ref: "DCA-BTC-26W46-1",
      week: "26W46",
      status: "filled",
      filledQuote: "9",
      filledQty: "0.0001",
      avgPrice: "64000",
    });
    window.localStorage.clear(); // the filters start from their defaults
    serve(book({ orders: [dropped, old, order({}), filledEth] }));
    render(<DcaBookPage />);
    await ordersOf("BTC");
    const panel = () => screen.getByRole("dialog");
    const table = () => within(panel()).getByRole("table", { name: "Orders" });
    expect(within(table()).queryByText(/DCA-BTC-26W47-3/)).toBeNull();
    fireEvent.click(within(panel()).getByRole("button", { name: /^Cancelled/ }));
    expect(within(table()).getByText(/DCA-BTC-26W47-3/)).toBeTruthy();
    fireEvent.click(within(panel()).getByRole("button", { name: /^Filled/ }));
    // This week only, until the week filter widens.
    expect(within(panel()).queryByText(/DCA-BTC-26W46-1/)).toBeNull();
    fireEvent.change(within(panel()).getByLabelText("Week"), { target: { value: "all" } });
    expect(within(table()).getByText(/DCA-BTC-26W46-1/)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("desk.dca.orders") ?? "{}")).toMatchObject({
      state: "filled",
      week: "all",
    });
    // A filled order opens read-only: no Modify.
    fireEvent.click(screen.getByRole("button", { name: "Actions for DCA-BTC-26W46-1" }));
    expect(screen.queryByRole("menuitem", { name: "Modify" })).toBeNull();
    window.localStorage.clear();
  });

  it("dedupes only what's ticked, keeping the oldest at each price", async () => {
    const twin = order({ ref: "DCA-BTC-26W47-2", created: START + 7_200_000 });
    const fetch = serve(book({ orders: [twin, order({}), filledEth] }));
    render(<DcaBookPage />);
    await ordersOf("BTC");
    fireEvent.click(screen.getByRole("button", { name: "Dedupe" }));
    const box = screen.getByRole("dialog", { name: "Orders at the same price" });
    const [first, second] = within(box).getAllByRole("checkbox") as HTMLInputElement[];
    expect(first?.checked).toBe(false); // the oldest, kept
    expect(second?.checked).toBe(true);
    fireEvent.click(within(box).getByRole("button", { name: "Cancel 1" }));
    await waitFor(() => expect(sent(fetch, "/dca/orders/cancel")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/dca/orders/cancel")[0]?.[1]?.body))).toEqual({
      ref: "DCA-BTC-26W47-2",
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
