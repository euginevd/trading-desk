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
    if (path === "/pot/scan")
      return json({ ...reply, lastScan: { at: NOW, line: "No setup today." } });
    if (path === "/pot/put-in") return json(pot());
    if (path === "/pot/trades")
      return json(
        trade({ ref: "TRD-SUI-26W47-1", coin: "SUI", status: "waiting", entry: "3.4172" }),
      );
    if (path === "/pot/trades/stop") return json(trade({ stop: "135.5" }));
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
  it("leads with the money, the market and what's on", async () => {
    serve(pot());
    render(<PotPage />);
    const head = await screen.findByRole("heading", { level: 1 });
    expect(head.textContent).toBe(
      "Pot $101, up $1.36 from trading. 1 trade on, 1 waiting for you.",
    );
    expect(screen.getByText(/Test phase: \$10 a trade, at most \$1 at risk\./)).toBeTruthy();
    expect(screen.getByText("Neutral")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "SOL trade TRD-SOL-26W47-1: open its panel" }),
    ).toBeTruthy();
    expect(screen.getByText("+0.6R")).toBeTruthy();
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
    expect(await screen.findByText("The trading pot is empty.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Amount to put in, USDC" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Put in" }));
    await waitFor(() => expect(sent(fetch, "/pot/put-in")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/pot/put-in")[0]?.[1]?.body))).toEqual({ usdc: "100" });
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
