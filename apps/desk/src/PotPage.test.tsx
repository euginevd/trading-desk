import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PotPage from "./PotPage";
import type { PotProposal, PotTrade, PotView } from "./types";

// Made-up figures only (known-mistakes 7).
const NOW = Date.UTC(2026, 10, 17, 3, 0); // Tue 17 Nov, 2pm Sydney

const trade = (t: Partial<PotTrade>): PotTrade => ({
  ref: "TRD-SOL-26W47-1",
  coin: "SOL",
  setup: "pullback",
  regime: "neutral",
  reason: "Pulled back to the 20-day on falling volume.",
  status: "open",
  entry: "135.47",
  stop: "131.2",
  target: "144.1",
  qty: "0.0738",
  spend: "10",
  risk: "0.32",
  fillPrice: "135.47",
  now: "138.02",
  exitPrice: null,
  exitKind: null,
  result: "0.19",
  r: "0.6",
  fees: "0.01",
  rulesKept: true,
  created: NOW - 3_600_000,
  filled: NOW - 1_800_000,
  closed: null,
  note: null,
  orders: [
    {
      ref: "TRD-SOL-26W47-1-E",
      role: "entry",
      kind: "limit",
      price: "135.47",
      stop: null,
      qty: "0.0738",
      status: "filled",
      created: NOW - 3_600_000,
    },
    {
      ref: "TRD-SOL-26W47-1-X1",
      role: "exit",
      kind: "oco",
      price: "144.1",
      stop: "131.2",
      qty: "0.0738",
      status: "open",
      created: NOW - 1_800_000,
    },
  ],
  ...t,
});

const proposal: PotProposal = {
  id: "p1",
  created: NOW,
  coin: "SUI",
  setup: "trend pullback",
  reason: "Up trend with higher lows, back to its 20-day.",
  entry: "3.4172",
  stop: "3.1388",
  target: "4.0091",
  qty: "2.93",
  spend: "10",
  risk: "0.81",
  stopPct: "8.1",
  rr: "2.1",
  crowding: "Clear",
};

const pot = (p: Partial<PotView> = {}): PotView => ({
  quote: "USDC",
  config: { mode: "test", fixed: "10", riskPct: "1" },
  putIn: "100",
  value: "101.36",
  result: "1.36",
  resultPct: "1.36",
  cash: "90",
  openRisk: "0.32",
  fees: "0.03",
  monthResult: "1.05",
  monthLimit: "6",
  regime: { state: "neutral", words: "above its 200-day, 50-day still under it" },
  nextScan: NOW + 76_500_000,
  lastScan: { at: NOW - 3_600_000, line: "Neutral. Setup found: SUI." },
  proposals: [proposal],
  trades: [trade({})],
  moves: [{ ref: "POT-IN-1", kind: "in", usdc: "100", created: NOW - 86_400_000 }],
  stats: {
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    avgWinR: null,
    avgLossR: null,
    expectancyR: null,
    drawdownPct: "0",
    judgeAfter: 30,
  },
  coins: ["BTC", "ETH", "SOL", "SUI"],
  priceError: null,
  ...p,
});

function serve(reply: PotView) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    void init;
    const path = url.replace(/^\/api/, "");
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (path === "/pot") return json(reply);
    if (path === "/pot/coins")
      return json({
        quote: "USDC",
        list: 7,
        max: 10,
        coins: [
          {
            coin: "SOL",
            amount: "2",
            price: "138.02",
            value: "276.04",
            change24hPct: "1.8",
            change30dPct: "-4.2",
            spark: ["130", "134", "138.02"],
            insight: {
              trend: "Up trend: above its 50- and 200-day.",
              setup: "Back at its 20-day: worth an Analyse.",
              status: "watch",
            },
            tradable: true,
            watching: false,
            inTrade: true,
          },
          {
            coin: "TAO",
            amount: "1",
            price: "300",
            value: "300",
            change24hPct: "-0.5",
            change30dPct: null,
            spark: [],
            insight: null,
            tradable: false,
            watching: false,
            inTrade: false,
          },
        ],
      });
    if (path === "/pot/scan")
      return json({ ...reply, lastScan: { at: NOW, line: "No setup today." } });
    if (path === "/pot/put-in") return json(pot());
    if (path === "/pot/trades")
      return json(
        trade({ ref: "TRD-SUI-26W47-1", coin: "SUI", status: "waiting", entry: "3.4172" }),
      );
    if (path === "/pot/trades/stop") return json(trade({ stop: "135.5" }));
    if (path === "/pot/preview") {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      const base = { coin: body.coin, ref: "TRD-SOL-26W47-2", now: "138.02", tick: "0.01" };
      if (!body.stop) return json({ ...base, trade: null, problems: [] });
      return json({
        ...base,
        trade: {
          coin: "SOL",
          entry: body.entry,
          stop: body.stop,
          target: body.target,
          qty: "0.073",
          spend: "10.08",
          risk: "0.52",
          stopPct: "5.0",
          rr: "2.8",
          reward: "1.47",
          targetPct: "15.0",
          riskOfPot: "0.51",
          allowed: "1.01",
          fees: "0.02",
          breakeven: "138.31",
        },
        problems:
          Number(body.target) < 150
            ? ["Reward to risk is 1.4 : 1 after fees; the rules need 2 : 1."]
            : [],
      });
    }
    if (path === "/pot/analyse")
      return json({
        coin: "SOL",
        verdict: "take",
        headline: "SOL pulled back to its 20-day in an up trend.",
        points: ["Above its 50-day at 131.", "Volume fell on the dip."],
        watch: "",
        plan: {
          setup: "Trend pullback",
          entry: "137.5",
          stop: "131.11",
          target: "158.75",
          why: "Back at its 20-day with volume drying up.",
          wrongIf: "it closes under 131",
        },
        regime: { state: "neutral", words: "" },
      });
    if (path === "/pot/agent")
      return json({ reply: "No setup today: SOL hasn't held its 20-day.", actions: [], said: [] });
    return json({ error: "Not found." }, 404);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const sent = (fetch: ReturnType<typeof serve>, path: string) =>
  fetch.mock.calls.filter(([url]) => String(url) === `/api${path}`);

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // no storage in this run
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the trading pot", () => {
  it("leads with the account's money, then coins and trades in tabs", async () => {
    serve(pot({ allowedRisk: "1.01", backing: { free: "80", held: "90", short: "10" } }));
    render(<PotPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Trading account");
    expect(screen.getByText("1 setup is waiting for you.")).toBeTruthy();
    const money = document.querySelector(".dcb-totals") as HTMLElement;
    expect(within(money).getByText("Available")).toBeTruthy();
    expect(within(money).getByText("In trades")).toBeTruthy();
    // Free USDC short of what the account holds: warned, never blocked.
    expect(screen.getByRole("alert").textContent).toContain(
      "is $10 short of the account's available $90",
    );
    expect(screen.getByText("Neutral")).toBeTruthy();
    // The watchlist, at the foot: one word on what to do, and a panel per coin.
    const card = await screen.findByRole("button", { name: /^SOL: Back at its 20-day/ });
    expect(card.textContent).toContain("In a trade");
    // Tabs: Positions first, the open trade in it; Orders holds none.
    const tabs = screen.getByRole("tablist", { name: "Trades" });
    expect(
      within(tabs)
        .getByRole("tab", { name: /Positions/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "SOL trade TRD-SOL-26W47-1: open its panel" }),
    ).toBeTruthy();
    expect(screen.getByText("+0.6R")).toBeTruthy();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Ledger" }));
    expect(screen.getByRole("table", { name: "The account's ledger" }).textContent).toContain(
      "POT-IN-1",
    );
    // A coin trading-agent doesn't trade opens read-only: no Ask, no New trade.
    fireEvent.click(screen.getByRole("button", { name: /^TAO/ }));
    const tao = screen.getByRole("dialog", { name: "TAO" });
    expect(within(tao).queryByRole("button", { name: "Ask trading-agent" })).toBeNull();
    fireEvent.click(within(tao).getByRole("button", { name: "Close" }));
    fireEvent.click(card);
    const sol = screen.getByRole("dialog", { name: "SOL" });
    expect(within(sol).getByRole("button", { name: "Ask trading-agent" })).toBeTruthy();
    fireEvent.click(within(sol).getByRole("button", { name: "New trade on SOL" }));
    expect(await screen.findByRole("heading", { name: "New trade" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "SOL" }).getAttribute("aria-checked")).toBe("true");
  });

  it("places a proposal after its review", async () => {
    const fetch = serve(pot());
    render(<PotPage />);
    const card = await screen.findByRole("article", { name: "Proposal: SUI, trend pullback" });
    fireEvent.click(within(card).getByRole("button", { name: "Review" }));
    const list = screen.getByRole("list", { name: "The trade's orders" });
    expect(list.textContent).toContain("limit buy 3.4172");
    expect(list.textContent).toContain("−$0.81");
    fireEvent.click(screen.getByRole("button", { name: "Place the trade" }));
    await waitFor(() => expect(sent(fetch, "/pot/trades")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/pot/trades")[0]?.[1]?.body))).toEqual({
      coin: "SUI",
      entry: "3.4172",
      stop: "3.1388",
      target: "4.0091",
      setup: "trend pullback",
      reason: "Up trend with higher lows, back to its 20-day.",
      proposal: "p1",
    });
    expect(await screen.findByText(/TRD-SUI-26W47-1 placed/)).toBeTruthy();
  });

  it("opens a trade's panel and moves its stop toward profit", async () => {
    const fetch = serve(pot());
    render(<PotPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "SOL trade TRD-SOL-26W47-1: open its panel" }),
    );
    expect(screen.getByText("TRD-SOL-26W47-1-X1")).toBeTruthy();
    const stop = screen.getByRole("textbox", { name: "TRD-SOL-26W47-1 new stop" });
    const move = screen.getByRole("button", { name: "Move stop" });
    fireEvent.change(stop, { target: { value: "130" } });
    expect(move).toHaveProperty("disabled", true); // never further away
    fireEvent.change(stop, { target: { value: "135.5" } });
    fireEvent.click(move);
    await waitFor(() => expect(sent(fetch, "/pot/trades/stop")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/pot/trades/stop")[0]?.[1]?.body))).toEqual({
      ref: "TRD-SOL-26W47-1",
      stop: "135.5",
    });
  });

  it("scans when asked", async () => {
    const fetch = serve(pot({ proposals: [], trades: [] }));
    render(<PotPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(sent(fetch, "/pot/scan")).toHaveLength(1));
    // The api takes changes only as JSON: a scan with nothing to say still sends {}.
    const init = sent(fetch, "/pot/scan")[0]?.[1];
    expect(init?.body).toBe("{}");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect((await screen.findAllByText("No setup today.")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Scanned: no setup today/)).toBeTruthy();
  });

  it("starts an empty pot with money put in", async () => {
    const fetch = serve(
      pot({ putIn: "0", value: "0", result: "0", moves: [], trades: [], proposals: [] }),
    );
    render(<PotPage />);
    expect(
      await screen.findByText("Put money in to start; it's kept apart from the DCA book."),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Amount to put in, USDC" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Put in" }));
    await waitFor(() => expect(sent(fetch, "/pot/put-in")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/pot/put-in")[0]?.[1]?.body))).toEqual({ usdc: "100" });
  });

  it("builds a trade by hand, sized as it's typed, and reviews it with its note", async () => {
    const fetch = serve(pot({ proposals: [], trades: [] }));
    render(<PotPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New trade" }));
    fireEvent.click(screen.getByRole("radio", { name: "SOL" }));
    const entry = screen.getByRole("textbox", { name: "Entry price" });
    await waitFor(() => expect(entry).toHaveProperty("value", "138.02"));
    expect(screen.getByText("Will be TRD-SOL-26W47-2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "−5%" }));
    expect(screen.getByRole("textbox", { name: "Stop loss price" })).toHaveProperty(
      "value",
      "131.11",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Take profit price" }), {
      target: { value: "145" },
    });
    expect(
      await screen.findByText("Reward to risk is 1.4 : 1 after fees; the rules need 2 : 1."),
    ).toBeTruthy();
    const review = screen.getByRole("button", { name: "Review" });
    expect(review).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "3R" }));
    expect(await screen.findByText(/Every rule kept/)).toBeTruthy();
    expect(screen.getByText("2.8 : 1")).toBeTruthy();
    expect(review).toHaveProperty("disabled", true); // no reason yet
    fireEvent.change(screen.getByRole("textbox", { name: "Why this trade" }), {
      target: { value: "Held its 50-day twice on falling volume" },
    });
    fireEvent.click(review);
    expect(screen.getByRole("list", { name: "The trade's orders" }).textContent).toContain(
      "limit buy 138.02",
    );
    fireEvent.click(screen.getByRole("button", { name: "Place the trade" }));
    await waitFor(() => expect(sent(fetch, "/pot/trades")).toHaveLength(1));
    const placed = JSON.parse(String(sent(fetch, "/pot/trades")[0]?.[1]?.body)) as Record<
      string,
      string
    >;
    expect(placed).toMatchObject({
      coin: "SOL",
      entry: "138.02",
      stop: "131.11",
      setup: "Pullback",
    });
    expect(placed.target).toBe("158.75");
    expect(placed.reason).toMatch(/^Held its 50-day twice on falling volume\. Review by /);
  });

  it("fills New trade from trading-agent's analysis, by the rules", async () => {
    const fetch = serve(pot({ proposals: [], trades: [] }));
    render(<PotPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New trade" }));
    fireEvent.click(screen.getByRole("radio", { name: "SOL" }));
    fireEvent.click(await screen.findByRole("button", { name: "Analyse SOL" }));
    expect(await screen.findByText("SOL pulled back to its 20-day in an up trend.")).toBeTruthy();
    expect(screen.getByText("Take")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Entry price" })).toHaveProperty("value", "137.5");
    expect(screen.getByRole("textbox", { name: "Stop loss price" })).toHaveProperty(
      "value",
      "131.11",
    );
    expect(screen.getByRole("textbox", { name: /^Why this trade/ })).toHaveProperty(
      "value",
      "Back at its 20-day with volume drying up.",
    );
    expect(screen.getByRole("button", { name: "Trend pullback" })).toHaveProperty(
      "ariaPressed",
      "true",
    );
    expect(JSON.parse(String(sent(fetch, "/pot/analyse")[0]?.[1]?.body))).toEqual({ coin: "SOL" });
    expect(await screen.findByText(/Every rule kept/)).toBeTruthy();
    // Each field says it's trading-agent's until the owner overrides it.
    expect(screen.getAllByText("trading-agent").length).toBeGreaterThanOrEqual(4);
    fireEvent.change(screen.getByRole("textbox", { name: "Stop loss price" }), {
      target: { value: "130" },
    });
    expect(screen.getByText("changed by you")).toBeTruthy();
    const agree = await screen.findByRole("button", { name: "Agree: review the orders" });
    await waitFor(() => expect(agree).toHaveProperty("disabled", false));
    expect(screen.getByRole("button", { name: "Don't take it" })).toBeTruthy();
  });

  it("keeps trading-agent folded until asked, then talks", async () => {
    const fetch = serve(pot());
    render(<PotPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("textbox", { name: "Message to trading-agent" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ask trading-agent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Why no trade today?" }));
    await waitFor(() => expect(sent(fetch, "/pot/agent")).toHaveLength(1));
    expect(await screen.findByText("No setup today: SOL hasn't held its 20-day.")).toBeTruthy();
  });
});
