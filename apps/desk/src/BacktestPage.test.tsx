import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BacktestPage from "./BacktestPage";
import { inR as r } from "./format";
import type { BacktestJob, BacktestRun, BacktestView } from "./types";

// Made-up figures only (known-mistakes 7).
const DAY = 86_400_000;
const row = (name: string, trades: number, total: number) => ({
  name,
  trades,
  won: 0.3,
  avg: total / trades,
  total,
});
const RUN: BacktestRun = {
  id: "backtest-result-2026-11-20_06-48-02",
  created: 1_795_000_000_000,
  style: "swing",
  ai: false,
  strategy: "DeskSwing",
  from: 1_700_000_000_000,
  to: 1_700_000_000_000 + 1095 * DAY,
  all: row("All", 10, -4.2),
  pairs: 20,
  worstRun: -6.5,
  curve: [
    [1_700_000_000_000 + DAY, 1.9],
    [1_700_000_000_000 + 9 * DAY, -4.2],
  ],
  bySetup: [row("Trend pullback", 6, -7.3), row("Sweep and reclaim", 4, 3.1)],
  byExit: [row("Stop", 7, -7), row("Target", 3, 2.8)],
  byYear: [row("2024", 10, -4.2)],
  trades: [
    {
      pair: "SOL/USDT",
      coin: "SOL",
      setup: "Sweep and reclaim",
      opened: 1_700_000_000_000,
      closed: 1_700_000_000_000 + 9 * DAY,
      entry: 100,
      exit: 120,
      stop: 90,
      target: 120,
      exitReason: "Target",
      r: 1.96,
    },
  ],
};
const VIEW: BacktestView = {
  styles: [
    {
      key: "swing",
      name: "Swing",
      candles: "daily",
      takes: "under a minute",
      ai: true,
      from: "2023-11-20",
      to: "2026-11-19",
    },
    {
      key: "position",
      name: "Position",
      candles: "weekly",
      takes: "under a minute",
      ai: false,
      from: "2023-11-20",
      to: "2026-11-19",
    },
  ],
  runs: [{ ...RUN }],
  job: null,
  worker: { seen: 1, on: true },
};
const JOB: BacktestJob = {
  id: "job-20261120-070402-58edab",
  style: "swing",
  ai: true,
  from: "2024-01-01",
  to: "2026-11-19",
  created: 1,
  state: "running",
  step: "Testing",
  started: 1,
  finished: null,
  error: null,
  result: null,
  cancelling: false,
  log: ["Backtesting with data from 2024-01-01"],
};

function serve(view: BacktestView, after?: BacktestView) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "");
    const reply =
      init?.method === "POST" ? (after ?? view) : path.startsWith("/backtest/run") ? RUN : view;
    return Promise.resolve(new Response(JSON.stringify(reply), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the backtest page", () => {
  it("opens the newest run in R: the sentence, tiles, breakdowns and trades", async () => {
    serve(VIEW);
    render(<BacktestPage />);
    await screen.findByRole("heading", {
      level: 1,
      name: "Swing lost 4.2R over 3 years; Sweep and reclaim made +3.1R.",
    });
    expect(screen.getByText("−6.5R")).toBeTruthy(); // worst run from a high
    expect(screen.getByText("Trend pullback")).toBeTruthy();
    const trades = screen.getByRole("region", { name: "Trades" });
    expect(within(trades).getByText("SOL")).toBeTruthy();
    expect(within(trades).getByText("+1.96R")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Equity curve ending at −4.2R/ })).toBeTruthy();
  });

  it("queues a run with the style, AI filter and dates, then shows its progress", async () => {
    const fetch = serve(VIEW, { ...VIEW, job: JOB });
    render(<BacktestPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "AI filter (FreqAI)" }));
    fireEvent.click(screen.getByRole("button", { name: "Run swing backtest with AI" }));
    await screen.findByRole("button", { name: "Cancel run" });
    const sent = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({
      style: "swing",
      ai: true,
      from: "2023-11-20",
      to: "2026-11-19",
    });
    expect(screen.getByText("Now: Testing")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Testing swing, ai filter…");
  });

  it("turns the AI filter off for position, which has none", async () => {
    serve(VIEW);
    render(<BacktestPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Position" }));
    expect(
      (screen.getByRole("checkbox", { name: "AI filter (FreqAI)" }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("says what to do with no runs yet, a stopped worker, and a failed run", async () => {
    serve({
      ...VIEW,
      runs: [],
      worker: { seen: null, on: false },
      job: { ...JOB, state: "failed", error: "Freqtrade stopped while testing.", finished: 42_000 },
    });
    render(<BacktestPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      "No backtests yet.",
    );
    expect(screen.getByText(/backtest worker isn.t running/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /failed after 42s/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run again" })).toBeTruthy();
  });

  it("shows an error with a retry when the api can't answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("down"))),
    );
    render(<BacktestPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("isn't running");
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy());
  });

  it("signs R with a true minus", () => {
    expect(r(-1.25, 2)).toBe("−1.25R");
    expect(r(0.4)).toBe("+0.4R");
    expect(r(0)).toBe("0.0R");
  });
});
