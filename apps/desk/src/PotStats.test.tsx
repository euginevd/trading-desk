import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PotStats from "./PotStats";
import type { PotView } from "./types";

// Made-up figures only (known-mistakes 7).
const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 2, 3, 0); // Mon 2 Nov, 2pm Sydney

const OVERALL: PotView["stats"] = {
  trades: 0,
  wins: 0,
  losses: 0,
  winRate: null,
  avgWinR: null,
  avgLossR: null,
  expectancyR: null,
  drawdownPct: "0",
  judgeAfter: 30,
};
const EMPTY: PotView["stats"] = { ...OVERALL, byStyle: [], bySetup: [], curve: [] };

const STATS: PotView["stats"] = {
  trades: 3,
  wins: 2,
  losses: 1,
  winRate: "66",
  avgWinR: "1.75",
  avgLossR: "-1",
  expectancyR: "0.83",
  drawdownPct: "1",
  judgeAfter: 30,
  byStyle: [
    {
      name: "Swing",
      trades: 2,
      wins: 1,
      winRate: "50",
      expectancyR: "0.5",
      totalR: "1",
      result: "10.00",
    },
    {
      name: "Other",
      trades: 1,
      wins: 1,
      winRate: "100",
      expectancyR: "1.5",
      totalR: "1.5",
      result: "15.00",
    },
  ],
  bySetup: [
    {
      name: "Swing - Trend pullback",
      trades: 2,
      wins: 1,
      winRate: "50",
      expectancyR: "0.5",
      totalR: "1",
      result: "10.00",
    },
    {
      name: "Pullback",
      trades: 1,
      wins: 1,
      winRate: "100",
      expectancyR: "1.5",
      totalR: "1.5",
      result: "15.00",
    },
  ],
  curve: [
    { closed: START, r: "2", cumR: "2", cumResult: "20.00" },
    { closed: START + DAY, r: "-1", cumR: "1", cumResult: "10.00" },
    { closed: START + 2 * DAY, r: "1.5", cumR: "2.5", cumResult: "25.00" },
  ],
};

afterEach(cleanup);

describe("PotStats", () => {
  it("shows the overall figures, the equity curve and both tables", () => {
    render(<PotStats stats={STATS} />);

    expect(screen.getByText("Win rate").nextElementSibling?.textContent).toBe("66%");
    expect(screen.getByText("Average loss").nextElementSibling?.textContent).toBe("−1.0R");

    const curve = screen.getByRole("img", { name: /Equity curve in R/ });
    expect(curve.getAttribute("aria-label")).toContain(
      "3 closed trades since 2 Nov 2026: +2.5R, +$25.",
    );
    expect(curve.querySelector("path")?.getAttribute("d")?.match(/[ML]/g)).toHaveLength(4);
    expect(screen.getByText("3 closed trades since 2 Nov 2026: +2.5R, +$25.")).toBeTruthy();

    const byStyle = within(screen.getByRole("region", { name: "By style" }));
    const swing = within(byStyle.getByRole("row", { name: /Swing/ }));
    expect(swing.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "2",
      "50%",
      "+0.5R",
      "+1.0R",
      "+$10",
    ]);
    expect(byStyle.getByRole("rowheader", { name: "Other" })).toBeTruthy();

    const bySetup = within(screen.getByRole("region", { name: "By setup" }));
    expect(bySetup.getByRole("rowheader", { name: "Swing - Trend pullback" })).toBeTruthy();
    expect(bySetup.getByRole("rowheader", { name: "Pullback" })).toBeTruthy();
  });

  it("says how many closed trades there are of those needed when none has closed", () => {
    render(<PotStats stats={EMPTY} />);

    expect(screen.getByText(/0 closed trades of the 30 needed to judge a style/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("draws nothing extra for an api that sends only the overall figures", () => {
    render(<PotStats stats={OVERALL} />);

    expect(screen.getByText("Trades").nextElementSibling?.textContent).toBe("0");
    expect(screen.queryByRole("table")).toBeNull();
  });
});
