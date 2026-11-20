import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BacktestPage, { monthsBefore } from "./BacktestPage";
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
  coin: "SOL",
  strategy: "DeskSwing",
  from: 1_700_000_000_000,
  to: 1_700_000_000_000 + 92 * DAY,
  all: row("All", 10, -4.2),
  pairs: 1,
  worstRun: -6.5,
  curve: [
    [1_700_000_000_000 + DAY, 1.9],
    [1_700_000_000_000 + 9 * DAY, -4.2],
  ],
  bySetup: [row("Trend pullback", 6, -7.3), row("Sweep and reclaim", 4, 3.1)],
  byExit: [row("Stop", 7, -7), row("Target", 3, 2.8)],
  byYear: [row("2026", 10, -4.2)],
  trades: [
    {
      pair: "SOL/USDC",
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
    { key: "scalp", name: "Scalp", candles: "5-minute, 1-hour trend" },
    { key: "day", name: "Day trade", candles: "15-minute, 4-hour trend" },
    { key: "swing", name: "Swing", candles: "daily" },
    { key: "position", name: "Position", candles: "weekly" },
  ],
  coins: ["BTC", "ETH", "SOL"],
  quote: "USDC",
  from: "2026-10-19",
  to: "2026-11-19",
  runs: [{ ...RUN }],
  job: null,
  worker: { seen: 1, on: true },
};
const JOB: BacktestJob = {
  id: "job-20261120-070402-58edab",
  style: "day",
  coin: "ETH",
  ai: false,
  from: "2026-08-19",
  to: "2026-11-19",
  created: 1,
  state: "running",
  step: "Testing",
  started: 1,
  finished: null,
  error: null,
  result: null,
  cancelling: false,
  log: ["Backtesting with data from 2026-08-19"],
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
      name: "Swing on SOL lost 4.2R over 3 months; Sweep and reclaim made +3.1R.",
    });
    expect(screen.getByText("−6.5R")).toBeTruthy(); // worst run from a high
    expect(screen.getByText("Trend pullback")).toBeTruthy();
    const trades = screen.getByRole("region", { name: "Trades" });
    expect(within(trades).getByText("+1.96R")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Equity curve ending at −4.2R/ })).toBeTruthy();
  });

  it("backtests the picked type and coin over a month, or 3 at one tap", async () => {
    const fetch = serve(VIEW, { ...VIEW, job: JOB });
    render(<BacktestPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Day trade" }));
    fireEvent.change(screen.getByLabelText("Coin"), { target: { value: "ETH" } });
    expect(screen.getByRole("option", { name: "2. ETH/USDC" })).toBeTruthy();
    // A month to yesterday by default.
    expect(screen.getByRole("button", { name: "1 month" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-19");
    fireEvent.click(screen.getByRole("button", { name: "3 months" }));
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-08-19");
    fireEvent.click(screen.getByRole("button", { name: "Backtest day trade on ETH" }));
    await screen.findByRole("button", { name: "Cancel run" });
    const sent = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({
      style: "day",
      coin: "ETH",
      from: "2026-08-19",
      to: "2026-11-19",
    });
    expect(screen.getByText("Now: Testing")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Testing Day trade on ETH…");
  });

  it("takes the owner's own dates up to 3 months", async () => {
    serve(VIEW);
    render(<BacktestPage />);
    const from = (await screen.findByLabelText("From")) as HTMLInputElement;
    fireEvent.change(from, { target: { value: "2026-09-01" } });
    expect(from.value).toBe("2026-09-01");
    for (const name of ["1 month", "3 months"])
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    const run = screen.getByRole("button", { name: "Backtest swing on BTC" }) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    fireEvent.change(from, { target: { value: "2026-05-01" } });
    expect(screen.getByText(/a backtest covers 3 months at most/)).toBeTruthy();
    expect(run.disabled).toBe(true);
  });

  it("asks for a scan first when the desk doesn't know today's top 100", async () => {
    serve({ ...VIEW, coins: [] });
    render(<BacktestPage />);
    expect(await screen.findByText(/run a scan on the Trade page/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Backtest swing on a coin" }) as HTMLButtonElement)
        .disabled,
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
    expect(screen.getByRole("heading", { name: /Day trade on ETH failed after 42s/ })).toBeTruthy();
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

  it("folds Trades and Runs to their headings and remembers it", async () => {
    window.localStorage.clear();
    serve(VIEW);
    const { unmount } = render(<BacktestPage />);
    const trades = await screen.findByRole("button", { name: "Trades" });
    expect(trades.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(trades);
    expect(trades.getAttribute("aria-expanded")).toBe("false");
    const body = (id: string) => document.getElementById(id) as HTMLElement;
    expect(body("bt-trades-body").hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Runs" }));
    expect(body("bt-runs-body").hidden).toBe(true);
    unmount();
    render(<BacktestPage />);
    const again = await screen.findByRole("button", { name: "Trades" });
    expect(again.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(again);
    expect(body("bt-trades-body").hidden).toBe(false);
    window.localStorage.clear();
  });

  it("counts months back to the same day, or the month's last", () => {
    expect(monthsBefore("2026-03-31", 1)).toBe("2026-02-28");
    expect(monthsBefore("2026-01-15", 3)).toBe("2025-10-15");
  });

  it("signs R with a true minus", () => {
    expect(r(-1.25, 2)).toBe("−1.25R");
    expect(r(0.4)).toBe("+0.4R");
    expect(r(0)).toBe("0.0R");
  });
});
