// The Trade page with the trading agent (TODO 6). Made-up figures only (known-mistakes 7).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Trade from "./Trade";
import type {
  AgentPage,
  AgentRun,
  Market,
  RunStep,
  Settings,
  Signal,
  Terminal,
  Watchlist,
} from "./types";

const limits: Settings = {
  tradingOn: true,
  perOrder: "500",
  perDay: "1000",
  spentToday: "0",
  leftToday: "1000",
};

function watchlist(): Watchlist {
  return {
    lists: [
      { id: 1, name: "Portfolio", count: 3 },
      { id: 2, name: "Memes", count: 0 },
    ],
    list: { id: 1, name: "Portfolio" },
    coins: [
      {
        coin: "SOL",
        symbol: "SOLUSDC",
        pair: "SOL/USDC",
        price: "182.4",
        change24h: "-1.9",
        signal: null,
      },
      {
        coin: "BTC",
        symbol: "BTCUSDC",
        pair: "BTC/USDC",
        price: "98400",
        change24h: "2.1",
        signal: null,
      },
      {
        coin: "ETH",
        symbol: "ETHUSDC",
        pair: "ETH/USDC",
        price: "3100",
        change24h: "-0.4",
        signal: null,
      },
    ],
    max: 10,
    aiBudget: { spent: "0.36", cap: "20" },
  };
}

const market: Market = {
  symbol: "SOLUSDC",
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
    { t: 2, o: "183", h: "185", l: "181", c: "179", v: "120" },
    { t: 3, o: "179", h: "184", l: "178", c: "182.4", v: "90" },
  ],
  indicators: {
    rsi: "44.8",
    sma20: "180",
    sma50: "175",
    support: "176",
    resistance: "198",
    trend: "Up",
  },
};

function terminal(settings: Settings): Terminal {
  return {
    symbol: "SOLUSDC",
    pair: "SOL/USDC",
    pairs: [],
    price: "182.4",
    change24h: "-1.9",
    base: "SOL",
    quote: "USDC",
    quoteFree: "1250",
    baseFree: "4.5",
    step: "0.001",
    tick: "0.01",
    minOrder: "5",
    settings,
    trades: [],
    openOrders: [
      {
        orderId: 9,
        symbol: "SOLUSDC",
        time: 1,
        pair: "SOL/USDC",
        side: "Buy",
        type: "Limit",
        price: "168",
        amount: "1",
        filled: "0",
      },
    ],
  };
}

const agentPage: AgentPage = {
  version: 3,
  time: 1,
  agent: {
    name: "Jordan",
    title: "Trader",
    style: "balanced",
    focus: "both",
    brief: "",
    always: [],
    never: [],
    confidenceFloor: 50,
    autonomy: "propose",
    steps: {
      macro: { on: true, model: "haiku" },
      technical: { on: true, model: "haiku" },
      planfit: { on: true, model: "haiku" },
      debate: { on: false, model: "sonnet" },
      risk: { on: true, model: "haiku" },
      decision: { on: true, model: "opus" },
    },
  },
  history: [],
  told: "",
  estimate: "0.08",
  models: [],
  steps: [
    { key: "macro", title: "Macro and events", who: "Quinn", fixed: false },
    { key: "technical", title: "Technicals", who: "Kai", fixed: false },
    { key: "planfit", title: "Plan fit", who: "Ellis", fixed: false },
    { key: "debate", title: "Bull against bear", who: "two takes", fixed: false },
    { key: "risk", title: "Risk", who: "Riley", fixed: true },
    { key: "decision", title: "Decision", who: "Jordan", fixed: true },
  ],
};

const signal: Signal = {
  coin: "SOL",
  verdict: "Buy now",
  confidence: 62,
  sentiment: "Fearful",
  trend: "Down, oversold",
  rsi: "28",
  support: "176",
  resistance: "198",
  buyLevel: "176",
  price: "182.4",
  summary: "Oversold into support: the zone is where the DCA earns its keep.",
  reasons: [],
  model: "claude-opus-5-5",
  ranAt: 1,
  stale: false,
  action: "Add",
  confidenceBefore: 55,
  zones: {
    buy: { low: "170", high: "176" },
    noChase: "198",
    invalidation: { price: "165", next: null },
    trim: null,
  },
  why: {
    bull: "Held the weekly low at 176",
    bear: "Under the 200-day average",
    changeMind: "A daily close under 165",
  },
  watchFor: [{ price: "198", direction: "above", note: "Breakout over resistance" }],
};

function step(
  key: RunStep["key"],
  title: string,
  who: string,
  status: RunStep["status"],
  summary = "",
): RunStep {
  return {
    key,
    title,
    who,
    model: key === "brief" ? null : "Haiku 5.5",
    status,
    summary: status === "done" ? summary : "",
    points: [],
    events: [],
    cost: status === "done" && key !== "brief" ? "0.01" : "0",
    note: status === "skipped" ? "Off in your agent profile" : null,
  };
}

type Stage = "start" | "mid" | "done" | "stopped";
function run(stage: Stage): AgentRun {
  const after = (n: number): RunStep["status"] =>
    stage === "start"
      ? "pending"
      : stage === "mid" || stage === "stopped"
        ? n <= 2
          ? "done"
          : "pending"
        : "done";
  const steps: RunStep[] = [
    step("brief", "Brief", "code", "done", "Read Profile v7 and your SOL position."),
    step(
      "macro",
      "Macro and events",
      "Quinn, Market Researcher",
      after(1),
      "Fear and greed at 18.",
    ),
    step("technical", "Technicals", "Kai, Technical Analyst", after(2), "Daily RSI 28, oversold."),
    step("planfit", "Plan fit", "Ellis", after(3), "At 12% against a 20% target."),
    step("debate", "Bull against bear", "two takes", "skipped"),
    step("risk", "Risk", "Riley, Risk Officer", after(5), "A$300 keeps SOL inside your max."),
    step("decision", "Decision", "Jordan", after(6), "Add, in the zone."),
  ];
  if (stage === "stopped") {
    steps[3] = {
      ...step("planfit", "Plan fit", "Ellis", "failed"),
      note: "This month's AI cap of $20.00 is reached. Raise it in Settings, or wait until 1 Dec.",
    };
  }
  const finished = stage === "done";
  return {
    id: 41,
    coin: "SOL",
    started: Date.UTC(2026, 10, 15, 9, 12),
    finished: finished ? Date.UTC(2026, 10, 15, 9, 12, 38) : null,
    status: stage === "done" ? "done" : stage === "stopped" ? "stopped" : "running",
    agentVersion: 3,
    profileVersion: 7,
    cost: "0.05",
    agent: { name: "Jordan", title: "Trader", autonomy: "propose" },
    price: "182.4",
    change24h: "-1.9",
    position: {
      held: true,
      qty: "2.5",
      avgCost: "200",
      value: "456",
      pnlPct: "-8.8",
      weightPct: "12",
    },
    cashUsd: "1250",
    levels: [{ id: "r1", price: "190", source: "R1 resistance", awayPct: "4.2" }],
    guardrails: {
      capAud: "1500",
      monthSpentAud: "860",
      maxPctPerCoin: "20",
      sharePct: "12",
      perTradeAud: "500",
      minCashAud: "300",
      audPerUsd: "1.5",
    },
    steps,
    signal: finished ? signal : null,
    ticket: finished
      ? { side: "buy", price: "176", qty: "1.136", totalUsd: "199.94", totalAud: "300", breaks: [] }
      : null,
    noTicket: null,
    choice: null,
    asks: [],
    outOfDate: false,
  };
}

interface Options {
  startError?: string;
  stopAtCap?: boolean;
  last?: AgentRun | null;
  ruleBreak?: boolean;
  busy?: number; // how many busy replies /analyse/next gives first
}

function serve(options: Options = {}) {
  let nexts = 0;
  let current: AgentRun = run("done");
  let busy = options.busy ?? 0;
  let alerts = [
    {
      id: 5,
      coin: "SOL",
      direction: "below",
      price: "170",
      note: "Bottom of the add zone",
      created: 1,
      triggered: null,
    },
  ];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "").split("?")[0];
    const method = init?.method ?? "GET";
    const sent = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    let body: unknown = {};
    let status = 200;
    if (path === "/watchlist") body = watchlist();
    if (path === "/market") body = market;
    if (path === "/trade") body = terminal(limits);
    if (path === "/smart") body = { quote: "USDC", tradingOn: true, bots: [] };
    if (path === "/agent") body = agentPage;
    if (path === "/analyse/calls") {
      body = {
        calls: [
          {
            coin: "SOL",
            action: "Add",
            confidence: 62,
            ranAt: Date.now() - 2 * 3_600_000,
            outOfDate: false,
          },
          {
            coin: "BTC",
            action: "Hold",
            confidence: 50,
            ranAt: Date.now() - 3_600_000,
            outOfDate: true,
          },
        ],
      };
    }
    if (path === "/analyse/last") body = { run: options.last ?? null };
    if (path === "/analyse" && method === "POST") {
      if (options.startError) {
        status = 400;
        body = { error: options.startError };
      } else body = run("start");
    }
    if (path === "/analyse/next" && busy > 0) {
      busy -= 1;
      return Promise.resolve(
        new Response(JSON.stringify({ ...run("start"), busy: true }), { status: 200 }),
      );
    }
    if (path === "/alerts" && method === "GET") body = { alerts };
    if (path === "/alerts" && method === "POST") {
      const added = sent as { coin: string; direction: string; price: string; note: string };
      alerts = [...alerts, { id: 6, created: 2, triggered: null, ...added }];
      body = { alerts };
    }
    if (path?.startsWith("/alerts/") && method === "DELETE") {
      alerts = alerts.filter((a) => `/alerts/${a.id}` !== path);
      body = { alerts };
    }
    if (path === "/analyse/next") {
      nexts += 1;
      body = nexts === 1 ? run("mid") : options.stopAtCap ? run("stopped") : run("done");
    }
    if (path === "/analyse/choice") {
      current = { ...current, choice: sent.choice as AgentRun["choice"] };
      body = current;
    }
    if (path === "/analyse/ask") {
      current = {
        ...current,
        asks: [{ q: String(sent.question), a: "A limit at 176 already waits for a dip." }],
      };
      body = current;
    }
    if (path === "/analyse/rank") {
      body = {
        ranked: [
          { coin: "BTC", priority: "high", reason: "Near your add zone" },
          { coin: "ETH", priority: "low", reason: "Nothing has moved" },
        ],
        cost: "0.01",
      };
    }
    if (path === "/orders") {
      if (options.ruleBreak && !sent.override) {
        status = 400;
        body = {
          error: "This buy breaks your Profile.",
          ruleBreaks: [
            {
              rule: "max_pct_per_coin",
              label: "Max per coin",
              message: "SOL would be 24%, over your 20%.",
            },
          ],
        };
      } else body = { message: "Limit buy placed on SOLUSDC." };
    }
    if (path === "/orders/cancel") body = { message: "Cancelled." };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function posts(fetch: ReturnType<typeof serve>, path: string) {
  return fetch.mock.calls
    .filter(([url, init]) => init?.method === "POST" && String(url).split("?")[0] === `/api${path}`)
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

function show() {
  render(<Trade settings={limits} onSettings={() => undefined} onStatus={() => undefined} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("trade page", () => {
  it("lists the coins with the agent's last call, and the agent ready to analyse", async () => {
    serve();
    show();
    const coins = await screen.findByRole("complementary", { name: "Coins" });
    expect(await within(coins).findByText("2h ago")).toBeTruthy(); // SOL's call
    expect(within(coins).getByText("Out of date")).toBeTruthy(); // BTC's
    expect(within(coins).getByText("No call yet")).toBeTruthy(); // ETH has none
    expect(await screen.findByRole("button", { name: "Analyse SOL" })).toBeTruthy();
    expect(screen.getByText(/About \$0.08 a run/)).toBeTruthy();
    // Before a run there's nothing to ask about: the box says so.
    const box = screen.getByLabelText("Ask Jordan");
    expect(box).toHaveProperty("disabled", true);
    expect(box.getAttribute("placeholder")).toBe(
      "Analyse SOL first, then ask Jordan about the call",
    );
    fireEvent.click(screen.getByRole("button", { name: "What would make you sell?" }));
    expect(box).toHaveProperty("value", "What would make you sell?");
  });

  it("runs Analyse step by step and shows the ticket, the levels and the guardrails", async () => {
    const fetch = serve();
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Analyse SOL" }));
    const ticket = await screen.findByRole("article", { name: "Jordan's call" });
    expect(posts(fetch, "/analyse")).toEqual([{ coin: "SOL" }]);
    expect(posts(fetch, "/analyse/next")).toEqual([{ id: 41 }, { id: 41 }]);

    // The steps fold into one line once the run is done.
    expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^How Jordan got there · \d+ steps/ }));
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(within(steps).getByText("Daily RSI 28, oversold.")).toBeTruthy();
    expect(within(steps).getByText("Off in your agent profile")).toBeTruthy();
    expect(within(steps).getAllByText("Haiku 5.5 · $0.01").length).toBe(5);
    expect(screen.getByText(/Analysed SOL at 8:12 pm · 38s · \$0.05/)).toBeTruthy();

    expect(within(ticket).getByText("Add")).toBeTruthy();
    expect(within(ticket).getByText(/^62% sure/)).toBeTruthy();
    expect(within(ticket).getByText(/was 55%/)).toBeTruthy();
    // The order in one line, with when it's wrong.
    const order = ticket.querySelector(".tr-order-what") as HTMLElement;
    expect(order.textContent).toMatch(/^Limit buy 1\.136 SOL at 176\.00 A\$300\.00/);
    expect(within(ticket).getByText("Out on a daily close under 165.00")).toBeTruthy();
    // The reasons fold under Why.
    expect(within(ticket).queryByText("Held the weekly low at 176")).toBeNull();
    fireEvent.click(within(ticket).getByRole("button", { name: "Why" }));
    expect(within(ticket).getByText("Held the weekly low at 176")).toBeTruthy();
    expect(
      within(ticket).getByText(
        /Within your Profile: per trade A\$500.00, cap left A\$640.00, max per coin 20%/,
      ),
    ).toBeTruthy();
    expect(ticket.getAttribute("title")).toMatch(/Agent v3 · Profile v7$/);

    const levels = screen.getByRole("region", { name: "Levels" });
    expect(within(levels).getByText("170.00 – 176.00")).toBeTruthy();
    expect(within(levels).getByText("R1 resistance")).toBeTruthy();
    // A ladder, highest first, with today's price as a row where it falls.
    const ladder = Array.from(levels.querySelectorAll("dt")).map((d) => d.textContent);
    expect(ladder.indexOf("Now")).toBeGreaterThan(ladder.indexOf("R1 resistance"));
    expect(ladder.indexOf("Now")).toBeLessThan(ladder.indexOf("Add zone"));
    const guard = screen.getByRole("region", { name: "Your guardrails" });
    expect(within(guard).getByText("A$860 of A$1.5K")).toBeTruthy();
    expect(within(guard).getByText("12% of 20%")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /SOL price, 4 hour, with the agent's levels/ }),
    ).toBeTruthy();
  });

  it("fills the order sheet from the ticket; the owner still reviews and confirms", async () => {
    const fetch = serve({ last: run("done") });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Use this order" }));
    const sheet = await screen.findByRole("dialog", { name: "Limit buy SOL" });
    expect(
      within(sheet).getByText("Filled from Jordan's call. Change anything; you still confirm."),
    ).toBeTruthy();
    expect(within(sheet).getByLabelText("Price")).toHaveProperty("value", "176.00");
    expect(within(sheet).getByLabelText("Amount")).toHaveProperty("value", "1.136");
    expect(within(sheet).getByText(/Within your Profile rules/)).toBeTruthy();
    expect(posts(fetch, "/orders")).toEqual([]); // nothing is sent until the owner confirms
    expect(posts(fetch, "/analyse/choice")).toEqual([]); // logged once the order is placed

    fireEvent.click(within(sheet).getByRole("button", { name: "Review limit buy SOL" }));
    const confirm = screen.getByRole("dialog", { name: "Limit buy 1.136 SOL at 176.00?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Place limit buy" }));
    await screen.findByText("Limit buy placed on SOLUSDC.");
    expect(posts(fetch, "/orders")[0]).toMatchObject({
      symbol: "SOLUSDC",
      side: "buy",
      price: "176.00",
      amount: "1.136",
    });
    expect(screen.queryByRole("dialog", { name: "Limit buy SOL" })).toBeNull();
    await waitFor(() =>
      expect(posts(fetch, "/analyse/choice")).toEqual([{ id: 41, choice: "used" }]),
    );
  });

  it("logs nothing when the sheet closes without an order", async () => {
    const fetch = serve({ last: run("done") });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Use this order" }));
    const sheet = await screen.findByRole("dialog", { name: "Limit buy SOL" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Limit buy SOL" })).toBeNull());
    expect(posts(fetch, "/analyse/choice")).toEqual([]);
  });

  it("holds an edited buy that breaks a rule until the owner places it anyway", async () => {
    const fetch = serve({ last: run("done"), ruleBreak: true });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog", { name: "Limit buy SOL" });
    fireEvent.change(within(sheet).getByLabelText("Amount"), { target: { value: "2" } });
    expect(
      within(sheet).getByText("Your Profile's rules are checked when you place it."),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Review limit buy SOL" }));
    fireEvent.click(screen.getByRole("button", { name: "Place limit buy" }));
    expect(await screen.findByText("SOL would be 24%, over your 20%.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place anyway (logged)" }));
    await screen.findByText("Limit buy placed on SOLUSDC.");
    expect(posts(fetch, "/orders").map((o) => o.override)).toEqual([undefined, true]);
    await waitFor(() =>
      expect(posts(fetch, "/analyse/choice")).toEqual([{ id: 41, choice: "edited" }]),
    );
  });

  it("shows a run found part way as paused, and spends only on Continue", async () => {
    const fetch = serve({ last: run("mid") });
    show();
    expect(await screen.findByText("Paused at step 4 of 7")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start over" })).toBeTruthy();
    await new Promise((done) => setTimeout(done, 50));
    expect(posts(fetch, "/analyse/next")).toEqual([]);
    expect(posts(fetch, "/analyse")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("article", { name: "Jordan's call" })).toBeTruthy();
    expect(posts(fetch, "/analyse/next")[0]).toEqual({ id: 41 });
    expect(posts(fetch, "/analyse")).toEqual([]);
  });

  it("waits and asks again while another request holds the step", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetch = serve({ busy: 2 });
      show();
      fireEvent.click(await screen.findByRole("button", { name: "Analyse SOL" }));
      await waitFor(() => expect(posts(fetch, "/analyse/next").length).toBe(1));
      await vi.advanceTimersByTimeAsync(2_000);
      await waitFor(() => expect(posts(fetch, "/analyse/next").length).toBe(2));
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await screen.findByRole("article", { name: "Jordan's call" })).toBeTruthy();
      expect(posts(fetch, "/analyse/next").length).toBe(4); // two busy, then mid and done
    } finally {
      vi.useRealTimers();
    }
  });

  it("sets an alert from a Watch for line and removes one", async () => {
    const fetch = serve({ last: run("done") });
    show();
    const card = await screen.findByRole("region", { name: "Alerts" });
    expect(await within(card).findByText(/Bottom of the add zone/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Set alert above 198.00" }));
    expect(await within(card).findByText(/Breakout over resistance/)).toBeTruthy();
    expect(posts(fetch, "/alerts")).toEqual([
      { coin: "SOL", direction: "above", price: "198", note: "Breakout over resistance" },
    ]);
    expect(screen.getByText("Alert set")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Remove alert below 170.00" }));
    await waitFor(() => expect(within(card).queryByText(/Bottom of the add zone/)).toBeNull());
    expect(
      fetch.mock.calls.some(([url, init]) => url === "/api/alerts/5" && init?.method === "DELETE"),
    ).toBe(true);
  });

  it("keeps a sell ticket clear of the buy rules", async () => {
    const done = run("done");
    serve({
      last: {
        ...done,
        ticket: {
          side: "sell",
          price: "198",
          qty: "1",
          totalUsd: "198",
          totalAud: "297",
          breaks: [],
        },
      },
    });
    show();
    const ticket = await screen.findByRole("article", { name: "Jordan's call" });
    expect(within(ticket).getByText("Sells don't count against your buy rules.")).toBeTruthy();
    expect(within(ticket).queryByText(/Within your Profile/)).toBeNull();
  });

  it("logs a dismissed call", async () => {
    const fetch = serve({ last: run("done") });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Dismissed, logged")).toBeTruthy();
    expect(posts(fetch, "/analyse/choice")).toEqual([{ id: 41, choice: "dismissed" }]);
    expect(screen.queryByRole("button", { name: "Use this order" })).toBeNull();
  });

  it("asks a follow-up about the run", async () => {
    const fetch = serve({ last: run("done") });
    show();
    const box = await screen.findByLabelText("Ask Jordan");
    await waitFor(() => expect(box).toHaveProperty("disabled", false));
    fireEvent.change(box, { target: { value: "Should I wait instead?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("A limit at 176 already waits for a dip.")).toBeTruthy();
    expect(posts(fetch, "/analyse/ask")).toEqual([{ id: 41, question: "Should I wait instead?" }]);
  });

  it("shows a run stopped by the AI cap in the timeline, with what to do", async () => {
    serve({ stopAtCap: true });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Analyse SOL" }));
    expect(
      await screen.findByText(/This month's AI cap of \$20.00 is reached. Raise it in Settings/),
    ).toBeTruthy();
    expect(screen.getByText("Stopped at step 4 of 7")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Settings" }).getAttribute("href")).toBe(
      "#/settings",
    );
    expect(screen.queryByRole("article", { name: "Jordan's call" })).toBeNull();
  });

  it("shows a run that couldn't start, with a retry", async () => {
    serve({ startError: "This month's AI cap of $20.00 is reached." });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Analyse SOL" }));
    const alert = await screen.findByText(/This month's AI cap of \$20.00 is reached./);
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("ranks the coins with Analyse all", async () => {
    const fetch = serve();
    show();
    const coins = await screen.findByRole("complementary", { name: "Coins" });
    fireEvent.click(await within(coins).findByRole("button", { name: "Analyse all" }));
    expect(await within(coins).findByText("Run first")).toBeTruthy();
    expect(within(coins).getByText("Near your add zone")).toBeTruthy();
    expect(within(coins).getByText("Can wait")).toBeTruthy();
    expect(posts(fetch, "/analyse/rank")).toEqual([{ coins: ["SOL", "BTC", "ETH"] }]);
  });

  it("opens a link's order in the sheet, filled in", async () => {
    serve();
    window.location.hash = "#/trade?coin=SOL&side=sell&price=190&qty=0.8&why=rebalance";
    show();
    const sheet = await screen.findByRole("dialog", { name: "Limit sell SOL" });
    expect(within(sheet).getByText(/Filled from your Portfolio/)).toBeTruthy();
    expect(within(sheet).getByLabelText("Price")).toHaveProperty("value", "190.00");
    expect(within(sheet).getByLabelText("Amount")).toHaveProperty("value", "0.800");
  });

  it("keeps open orders and smart trades viewable and cancellable", async () => {
    const fetch = serve();
    show();
    fireEvent.click(await screen.findByRole("tab", { name: "Orders and smart trades (1)" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Open orders (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(posts(fetch, "/orders/cancel")).toEqual([{ symbol: "SOLUSDC", orderId: 9 }]),
    );
  });

  it("places my own order from an empty sheet", async () => {
    serve();
    show();
    const own = await screen.findByRole("button", { name: "Place my own order" });
    await waitFor(() => expect(own).toHaveProperty("disabled", false));
    fireEvent.click(own);
    const sheet = await screen.findByRole("dialog", { name: "Limit buy SOL" });
    expect(within(sheet).getByLabelText("Amount")).toHaveProperty("value", "");
    expect(within(sheet).getByRole("button", { name: "Review limit buy SOL" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Limit buy SOL" })).toBeNull());
  });
});
