import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PotPage from "./PotPage";
import { rewardOf, rr } from "./PotPanel";
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
  style: null,
  notes: [
    {
      kind: "desk",
      text: "Filled 0.0738 at 135.47 (+0.00% from the planned 135.47).",
      created: NOW - 1_800_000,
    },
  ],
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

function serve(reply: PotView, breaksRule = false, setups = true) {
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
    if (path === "/pot/trades") {
      const asked = JSON.parse(String(init?.body ?? "{}")) as { override?: boolean };
      if (breaksRule && !asked.override)
        return json(
          {
            error: "This buy breaks your rule: Per trade.",
            ruleBreaks: [{ rule: "per_trade_aud", label: "Per trade", message: "A$15 over A$1." }],
          },
          409,
        );
      return json(
        trade({ ref: "TRD-SUI-26W47-1", coin: "SUI", status: "waiting", entry: "3.4172" }),
      );
    }
    if (path === "/pot/trades/stop") return json(trade({ stop: "135.5" }));
    if (path === "/pot/trades/reduce") return json(trade({ qty: "0.0369" }));
    if (path === "/pot/trades/add") return json(trade({ qty: "0.11" }));
    if (path === "/pot/trades/note")
      return json(
        trade({
          notes: [{ kind: "you", text: "Held the 20-day twice.", created: NOW }],
        }),
      );
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
    if (path === "/backtest")
      return json({
        styles: [],
        runs: [
          {
            id: "backtest-result-2026-11-20_06-48-02",
            created: 1,
            style: "day",
            ai: false,
            coin: "SOL",
            strategy: "DeskDay",
            from: 0,
            to: 365 * 86_400_000,
            all: { name: "All", trades: 12, won: 0.25, avg: -0.4, total: -4.8 },
          },
        ],
        job: null,
        worker: { seen: null, on: false },
      });
    if (path === "/pot/styles")
      return json({
        regime: { state: "bull", words: "BTC above its 200-day" },
        styles: [
          ["scalp", "Scalp", "5 to 60 minutes"],
          ["day", "Day trade", "1 to 12 hours"],
          ["swing", "Swing", "2 days to 3 weeks"],
          ["position", "Position", "3 weeks to 6 months"],
        ].map(([key, name, line]) => ({
          key,
          name,
          line,
          hold: line,
          riskPct: "1",
          minRr: "2",
          expirySeconds: 3600,
          allowed: true,
          note: "",
        })),
      });
    if (path === "/pot/screen")
      return json({
        style: "day",
        name: "Day trade",
        regime: { state: "bull", words: "" },
        allowed: true,
        note: "",
        riskPct: "0.5",
        warnings: [],
        counts: { listed: 100, onBinance: 82, liquid: 31, setups: setups ? 3 : 0 },
        shortlist: setups ? [{ coin: "SOL", setup: "Asia sweep", score: 7 }] : [],
        misses: setups ? [] : [{ coin: "ETH", why: "7.5% under its 4-hour 50 EMA" }],
        block: setups
          ? ""
          : "BTC's 4-hour close is 7.6% under its 50 EMA: no day trades until it's back above.",
        expires: Date.now() + 3_600_000,
      });
    if (path === "/pot/judge")
      return json({
        style: "day",
        name: "Day trade",
        regime: { state: "bull", words: "" },
        allowed: true,
        note: "",
        riskPct: "0.5",
        warnings: ["Late in the crypto day: a day trade must close by the 11am close."],
        counts: { listed: 100, onBinance: 82, liquid: 31, setups: 3 },
        line: "One clean Asia sweep on SOL.",
        expires: Date.now() + 3_600_000,
        picks: [
          {
            coin: "SOL",
            setup: "Asia sweep",
            grade: "A",
            score: 8.4,
            verdict: "take",
            confluence: ["4h trend up", "yesterday's low"],
            against: ["Under the 4h high"],
            catalyst: "None found in 48 hours.",
            crowding: "Clear",
            reason: "Swept the Asia low at 137 and closed back above.",
            problem: null,
            entry: "137",
            stop: "134",
            target: "143.2",
            qty: "0.036",
            spend: "4.93",
            risk: "0.12",
            rr: "2",
            stopPct: "2.2",
            odds: {
              needed: 34,
              horizon: "12 hours",
              lean: "leans no",
              line: "Rule over the last 10 days: target first 2 of 9 (22%). Needs 34% to break even.",
              sim: null,
              past: null,
            },
          },
        ],
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

// The Market scan tab holds the proposals, Scan now and the market (owner, 21 Nov 2026).
async function scanTab(): Promise<void> {
  fireEvent.click(await screen.findByRole("tab", { name: /Market scan/ }));
}

// A trade's panel: its position's row, then Orders, then Open on the buy.
async function openTrade(): Promise<void> {
  const positions = await screen.findByRole("table", { name: "Positions" });
  fireEvent.click(within(positions).getByRole("button", { name: /^SOL/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Orders · / }));
  const panel = screen.getByRole("dialog", { name: "SOL orders" });
  fireEvent.click(within(panel).getByRole("button", { name: "Open" }));
}

describe("the trading pot", () => {
  it("leads with the account's money, then its positions, then the watchlist", async () => {
    serve(pot({ allowedRisk: "1.01", backing: { free: "80", held: "90", short: "10" } }));
    render(<PotPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Trading account");
    const main = document.querySelector("main") as HTMLElement;
    // The tiles: what's free on Binance, the positions, and the P&L.
    expect(main.textContent).toContain("Available$80");
    expect(main.textContent).toContain("Unrealized+$0.19 +1.9%");
    expect(main.textContent).toContain("Realized$0 none closed");
    // One row a position, with what it holds and its P&L.
    const positions = await screen.findByRole("table", { name: "Positions" });
    const sol = within(positions).getByRole("button", { name: /^SOL/ });
    expect(sol.closest("tr")?.textContent).toContain("+$0.19 (+1.9%)");
    // It opens in place: Take profit, Add funds, and its Orders in a panel.
    fireEvent.click(sol);
    expect(screen.getByRole("button", { name: "Take profit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add funds" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Orders · / }));
    const orders = screen.getByRole("dialog", { name: "SOL orders" });
    expect(within(orders).getByText("TRD-SOL-26W47-1")).toBeTruthy();
    fireEvent.click(within(orders).getByRole("button", { name: "Close" }));
    // The watchlist: a coin trading-agent doesn't trade opens read-only.
    fireEvent.click(await screen.findByRole("button", { name: /^TAO/ }));
    const tao = screen.getByRole("dialog", { name: "TAO" });
    expect(within(tao).queryByRole("button", { name: "Ask trading-agent" })).toBeNull();
    fireEvent.click(within(tao).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /^SOL: Back at its 20-day/ }));
    const coin = screen.getByRole("dialog", { name: "SOL" });
    expect(within(coin).getByRole("button", { name: "Ask trading-agent" })).toBeTruthy();
    fireEvent.click(within(coin).getByRole("button", { name: "New trade on SOL" }));
    expect(await screen.findByRole("heading", { name: "New trade" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "SOL" }).getAttribute("aria-checked")).toBe("true");
  });

  it("places a proposal after its review", async () => {
    const fetch = serve(pot());
    render(<PotPage />);
    await scanTab();
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

  it("says when trading is off, from the side panel's switch", async () => {
    serve(pot());
    const { rerender } = render(<PotPage tradingOn={false} />);
    expect(await screen.findByText(/Trading is off: every new order is refused/)).toBeTruthy();
    rerender(<PotPage tradingOn />);
    expect(screen.queryByText(/Trading is off/)).toBeNull();
  });

  it("drops a late price-now reply once Limit is picked again", async () => {
    const fetch = serve(pot());
    const real = fetch.getMockImplementation();
    if (!real) throw new Error("serve() set no reply");
    let release = () => {};
    fetch.mockImplementation((url: string, init?: RequestInit) =>
      url === "/api/pot/preview"
        ? new Promise<Response>((done) => {
            release = () => void real(url, init).then(done);
          })
        : real(url, init),
    );
    render(<PotPage />);
    await scanTab();
    const card = await screen.findByRole("article", { name: "Proposal: SUI, trend pullback" });
    fireEvent.click(within(card).getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("radio", { name: /^Market now/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Limit at/ }));
    release(); // the price now arrives after the owner chose Limit
    await waitFor(() => expect(sent(fetch, "/pot/preview").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("radio", { name: /^Limit at/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Place the trade" }));
    await waitFor(() => expect(sent(fetch, "/pot/trades")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/pot/trades")[0]?.[1]?.body))).not.toHaveProperty(
      "market",
    );
  });

  it("says reward to risk after fees, as the api checks it", () => {
    // 100 in, 95 stop, 110.5 target: 2.1 before fees, under 2 after them.
    expect(rr({ entry: "100", stop: "95", target: "110.5" })).toBe("2.0");
    expect(rewardOf({ entry: "100", stop: "95", target: "110.5", qty: "1" })).toBeCloseTo(10.29);
  });

  it("holds a trade that breaks a Profile rule until it's placed anyway", async () => {
    const fetch = serve(pot(), true);
    render(<PotPage />);
    await scanTab();
    const card = await screen.findByRole("article", { name: "Proposal: SUI, trend pullback" });
    fireEvent.click(within(card).getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Place the trade" }));
    expect(await screen.findByText(/Breaks a rule/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place anyway (logged)" }));
    await waitFor(() => expect(sent(fetch, "/pot/trades")).toHaveLength(2));
    expect(JSON.parse(String(sent(fetch, "/pot/trades")[1]?.[1]?.body)).override).toBe(true);
    expect(await screen.findByText(/TRD-SUI-26W47-1 placed/)).toBeTruthy();
  });

  it("opens a trade's panel and moves its stop toward profit", async () => {
    const fetch = serve(pot());
    render(<PotPage />);
    await openTrade();
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

  it("logs a trade's events, keeps your note, and reduces it after a confirm", async () => {
    const fetch = serve(pot());
    render(<PotPage />);
    await openTrade();
    expect(screen.getByText(/Filled 0.0738 at 135.47/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add at market" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "TRD-SOL-26W47-1 note" }), {
      target: { value: "Held the 20-day twice." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Held the 20-day twice.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sell 50%" }));
    expect(sent(fetch, "/pot/trades/reduce")).toHaveLength(0); // asks first
    const confirm = screen.getAllByRole("button", { name: "Sell 50%" });
    fireEvent.click(confirm[confirm.length - 1] as HTMLElement);
    await waitFor(() => expect(sent(fetch, "/pot/trades/reduce")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/pot/trades/reduce")[0]?.[1]?.body))).toEqual({
      ref: "TRD-SOL-26W47-1",
      pct: "50",
    });
  });

  it("adds to a trade only after a confirm, then clears the amount", async () => {
    const fetch = serve(pot());
    render(<PotPage />);
    await openTrade();
    const amount = screen.getByRole("textbox", { name: "TRD-SOL-26W47-1 USDC to add" });
    fireEvent.change(amount, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add at market" }));
    expect(sent(fetch, "/pot/trades/add")).toHaveLength(0); // asks first
    expect(screen.getByText(/more SOL at market now/)).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: "Add at market" });
    fireEvent.click(confirm[confirm.length - 1] as HTMLElement);
    await waitFor(() => expect(sent(fetch, "/pot/trades/add")).toHaveLength(1));
    expect(JSON.parse(String(sent(fetch, "/pot/trades/add")[0]?.[1]?.body))).toEqual({
      ref: "TRD-SOL-26W47-1",
      usdc: "5",
    });
    await waitFor(() => expect(amount).toHaveProperty("value", "")); // a second click can't buy again
  });

  it("scans when asked", async () => {
    const fetch = serve(pot({ proposals: [], trades: [] }));
    render(<PotPage />);
    await scanTab();
    fireEvent.click(await screen.findByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(sent(fetch, "/pot/scan")).toHaveLength(1));
    // The api takes changes only as JSON: a scan with nothing to say still sends {}.
    const init = sent(fetch, "/pot/scan")[0]?.[1];
    expect(init?.body).toBe("{}");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
  });

  it("shows the market on the scan tab: the regime and what would turn it", async () => {
    serve(pot());
    render(<PotPage />);
    await scanTab();
    const main = document.querySelector("main") as HTMLElement;
    await waitFor(() => expect(main.textContent).toContain("Regime"));
    expect(main.textContent).toContain("Neutral");
  });

  it("shows a scan's steps as they end, and folds them to one line when asked", async () => {
    const base = serve(pot({ proposals: [], trades: [] }));
    const steps = [
      {
        style: "scalp",
        name: "Scalp",
        state: "done",
        notes: ["8 coins passed the filters, 2 setups", "trading-agent: 1 take, 1 wait"],
      },
      { style: "swing", name: "Swing", state: "failed", notes: ["Binance didn't answer."] },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        url === "/api/pot/scan/progress"
          ? Promise.resolve(
              new Response(
                JSON.stringify({ running: false, started: NOW, ended: NOW + 42_000, steps }),
              ),
            )
          : base(url, init),
      ),
    );
    render(<PotPage />);
    await scanTab();
    fireEvent.click(await screen.findByRole("button", { name: "Scan now" }));
    const panel = await screen.findByRole("region", { name: "Scan steps" });
    expect(within(panel).getByRole("status").textContent).toBe(
      "Scan finished: 1 of 2 done, 1 failed",
    );
    // The steps' own list; the inputs the scan reads sit folded under it.
    const items = () => panel.querySelectorAll("#pot-steps-list > li");
    const rows = [...items()];
    expect(rows[0]?.textContent).toContain("ScalpDone8 coins passed the filters, 2 setups");
    expect(rows[1]?.textContent).toContain("SwingFailedBinance didn't answer.");
    fireEvent.click(within(panel).getByRole("button", { name: "Hide steps" }));
    expect(items()).toHaveLength(0);
    expect(within(panel).getByRole("status").textContent).toContain("Scan finished");
    expect(window.localStorage.getItem("desk.pot.steps")).toBe("0");
    fireEvent.click(within(panel).getByRole("button", { name: "Show steps" }));
    expect(items()).toHaveLength(2);
  });

  it("adds up realized P&L from closed trades against what went in, this month under it", async () => {
    const closed = (ref: string, result: string, at: number) =>
      trade({ ref, status: "closed", result, closed: at, now: null });
    serve(
      pot({
        trades: [
          trade({}),
          closed("TRD-SOL-26W46-1", "3", NOW - 1000),
          closed("TRD-ETH-26W40-1", "-1", NOW - 90 * 86_400_000),
        ],
      }),
    );
    render(<PotPage />);
    await screen.findByRole("heading", { level: 1 });
    const real = (await screen.findByText("Realized")).closest("div") as HTMLElement;
    expect(real.textContent).toContain("+$2.00"); // 3 − 1
    expect(real.textContent).toContain("+$3.00 this month");
  });

  it("lists the watchlist as a table, a row a coin", async () => {
    const base = serve(pot({ proposals: [], trades: [] }));
    const coin = (name: string, more: object) => ({
      coin: name,
      amount: "0",
      price: "10",
      value: "0",
      change24hPct: "0.4",
      change30dPct: null,
      spark: ["9", "10"],
      insight: null,
      tradable: true,
      watching: false,
      inTrade: false,
      ...more,
    });
    const read = (status: string) => ({ trend: "Up trend.", setup: "A read.", status });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        url === "/api/pot/coins"
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  quote: "USDC",
                  list: 7,
                  max: 10,
                  coins: [
                    coin("BTC", {}),
                    coin("ETH", { insight: read("wait") }),
                    coin("LINK", { insight: read("none") }),
                    coin("SUI", { insight: read("watch") }),
                    coin("SOL", { inTrade: true, value: "25" }),
                  ],
                }),
              ),
            )
          : base(url, init),
      ),
    );
    render(<PotPage />);
    const table = await screen.findByRole("table", { name: "Watchlist coins" });
    for (const c of ["BTC", "ETH", "LINK", "SUI", "SOL"])
      expect(within(table).getByRole("button", { name: new RegExp(`^${c}:`) })).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Set one up yourself →" }));
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

  it("New trade scans a style and places the picked trade at that style's risk", async () => {
    const fetch = serve(pot({ proposals: [], trades: [] }));
    render(<PotPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New trade" }));
    // Each style's newest backtest sits on its card (decision 87).
    expect(
      await screen.findByText("Backtest on SOL, 1 yr: 12 trades, −0.40R a trade"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "See every backtest →" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Day trade/ }));
    expect(await screen.findByText("One clean Asia sweep on SOL.")).toBeTruthy();
    expect(screen.getByText(/Late in the crypto day/)).toBeTruthy();
    expect(screen.getByText("None found in 48 hours.")).toBeTruthy();
    expect(screen.getByText("Under the 4h high")).toBeTruthy();
    expect(screen.getByText("2 : 1")).toBeTruthy();
    expect(screen.getByText("Odds lean no")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Okay, review SOL" }));
    expect(await screen.findByText(/Day trade · Asia sweep/)).toBeTruthy();
    expect(screen.getAllByText(/target first 2 of 9/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Place the trade" }));
    await waitFor(() => expect(sent(fetch, "/pot/trades")).toHaveLength(1));
    const placed = JSON.parse(String(sent(fetch, "/pot/trades")[0]?.[1]?.body));
    expect(placed.style).toBe("day");
    expect(placed.entry).toBe("137");
    expect(typeof placed.expires).toBe("number");
  });

  it("an empty scan stays on Scan and says so, without asking trading-agent", async () => {
    const fetch = serve(pot({ proposals: [], trades: [] }), false, false);
    render(<PotPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New trade" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Day trade/ }));
    expect(
      await screen.findByText(/No day trade setups right now: 31 coins passed the rules/),
    ).toBeTruthy();
    expect(screen.getByText("7.5% under its 4-hour 50 EMA")).toBeTruthy();
    expect(screen.getByText(/no day trades until it's back above/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeTruthy();
    expect(sent(fetch, "/pot/judge")).toHaveLength(0);
  });

  it("fills New trade from trading-agent's analysis, by the rules", async () => {
    const fetch = serve(pot({ proposals: [], trades: [] }));
    render(<PotPage />);
    fireEvent.click(await screen.findByRole("button", { name: "New trade" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set one up yourself →" }));
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
