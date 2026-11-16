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
  const fetch = vi.fn((url: string) => {
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
