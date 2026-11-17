import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RiskPage from "./RiskPage";
import type { RiskBoard, RiskLimit } from "./types";

// Made-up figures only (known-mistakes 7).
const row = (r: Partial<RiskLimit>): RiskLimit => ({
  key: "pot-open-risk",
  area: "Trading pot",
  name: "Open risk",
  value: "2.8",
  warn: "2.55",
  limit: "3",
  figure: "2.8%",
  of: "3% across trades",
  rule: "5.4.3",
  owner: "trading-agent, on Trade",
  state: "near",
  words: "",
  ...r,
});

const board = (b: Partial<RiskBoard> = {}): RiskBoard => ({
  sentence: "Every rule kept; 1 near a limit: open risk.",
  limits: [
    row({}),
    row({
      key: "deposits",
      area: "Deposits",
      name: "Deposits this month",
      value: "3000",
      warn: "6000",
      limit: "7000",
      figure: "A$3,000",
      of: "A$7,000 a month",
      rule: "5.2.4",
      owner: "you",
      state: "kept",
    }),
  ],
  missing: [],
  review: null,
  checkedAt: 1,
  jobs: [],
  scheduleOn: true,
  ...b,
});

function serve(first: RiskBoard) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    void init; // read back from mock.calls
    const path = url.replace(/^\/api/, "");
    const reply =
      path === "/risk-board/review"
        ? board({
            review: {
              at: 2,
              headline: "Open risk is near its 3% limit.",
              sections: [{ title: "The trading pot", text: "2.8% open across two trades." }],
              action: "No new trade until one closes.",
            },
          })
        : first;
    return Promise.resolve(new Response(JSON.stringify(reply), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the risk page", () => {
  it("says how the rules stand and shows each limit by book", async () => {
    serve(board());
    render(<RiskPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      "Every rule kept; 1 near a limit: open risk.",
    );
    const pot = screen.getByRole("region", { name: "Trading pot" });
    expect(within(pot).getByText("Open risk")).toBeTruthy();
    expect(within(pot).getByText("Near")).toBeTruthy();
    expect(within(pot).getByText("1 to watch")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Deposits" })).getByText("All kept"),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Portfolio" })).toBeNull(); // no rows, no section
  });

  it("leads with the four big risks, the first not kept open, the everyday limits folded", async () => {
    const big = (r: Partial<RiskLimit>) =>
      row({ area: "Big", warn: null, owner: "you, on Risk", words: "", ...r });
    const fetch = serve(
      board({
        sentence: "A$2,000 over your Binance limit.",
        limits: [
          row({}),
          big({
            key: "big-exchange",
            rank: 1,
            name: "Money on Binance",
            value: "12000",
            limit: "10000",
            figure: "A$12,000",
            of: "A$10,000",
            state: "broken",
            detail: {
              totalAud: "12000",
              capAud: "10000",
              dcaAud: "9000",
              stablesAud: "3000",
              otherAud: "0",
              moveAud: "2000",
              moves: [{ coin: "BTC", aud: "2000", qty: "0.0200", leaves: "7000" }],
              afterAud: "10000",
            },
          }),
          big({
            key: "big-tao",
            rank: 3,
            name: "TAO's share of crypto",
            value: "70",
            limit: "60",
            figure: "70%",
            of: "60% by 31 Dec 2027",
            state: "near",
            detail: {
              valueAud: "10500",
              costAud: "15000",
              pnlAud: "-4500",
              cryptoAud: "15000",
              otherAud: "4500",
              weeklyAud: "600",
              targetPct: "60",
              by: "31 Dec 2027",
              weeks: 5,
              reach: 1_798_000_000_000,
              onTrack: true,
              thesisAt: null,
              thesisDue: true,
            },
          }),
          big({
            key: "big-backup",
            rank: 4,
            name: "Ledger backup",
            value: "50",
            limit: "100",
            figure: "2 of 4",
            of: "checks current",
            state: "near",
            detail: {
              items: [
                { key: "seed", label: "Seed backed up", at: 1, due: 2, state: "ok" },
                { key: "place", label: "Backup in place", at: 1, due: 2, state: "due" },
              ],
            },
          }),
        ],
      }),
    );
    render(<RiskPage />);
    const four = await screen.findByRole("list", { name: "The four big risks" });
    expect(within(four).getByText("Over")).toBeTruthy();
    // The first one not kept opens: the month's move to the Ledger.
    expect(screen.getByRole("table", { name: "Move to the Ledger" })).toBeTruthy();
    // TAO: the what-if follows the slider, and the sale is never proposed.
    fireEvent.change(screen.getByRole("slider", { name: "Share of TAO to sell" }), {
      target: { value: "40" },
    });
    expect(screen.getByText("A$4,200")).toBeTruthy(); // 40% of A$10,500 sold
    expect(screen.getByText("−A$1,800")).toBeTruthy(); // 40% of the loss realised
    expect(screen.getByText(/The desk never proposes this sale/)).toBeTruthy();
    // A backup check keeps today's date only.
    fireEvent.click(screen.getByRole("button", { name: "Backup in place: done today" }));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([u]) => String(u) === "/api/risk-board/check")).toBe(true),
    );
    const call = fetch.mock.calls.find(([u]) => String(u) === "/api/risk-board/check");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ key: "place" });
    expect(screen.getByText(/Everyday limits/)).toBeTruthy();
  });

  it("names a book it couldn't read rather than calling it kept", async () => {
    serve(board({ missing: ["the portfolio"] }));
    render(<RiskPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("the portfolio");
  });

  it("has risk-agent write the weekly review on demand", async () => {
    const fetch = serve(board());
    render(<RiskPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Write the review now" }));
    expect(await screen.findByText("Open risk is near its 3% limit.")).toBeTruthy();
    expect(screen.getByText(/No new trade until one closes\./)).toBeTruthy();
    await waitFor(() =>
      expect(fetch.mock.calls.some(([u]) => String(u) === "/api/risk-board/review")).toBe(true),
    );
  });
});
