import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { amount, percent, usd } from "./format";
import type { Portfolio } from "./types";

const portfolio: Portfolio = {
  fetchedAt: "2026-11-13T03:32:05+00:00",
  demo: true,
  total: {
    value: "2407.5",
    aud: "3548.17",
    audRate: "1.4738",
    audDate: "2026-11-13",
    change24h: "-8.46",
    change24hPercent: "-0.35",
    profit: "130",
    profitPercent: "8.81",
    cost: "1475",
  },
  holdings: [
    {
      asset: "BNB",
      amount: "3.75",
      price: "642",
      value: "2407.5",
      change24h: "-0.35",
      share: "100",
      averageCost: "590",
      covered: "2.5",
      profit: "130",
      profitPercent: "8.81",
    },
  ],
  openOrders: [],
  recentTrades: [],
};

function reply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("format", () => {
  it("shows money, signs and coin amounts plainly", () => {
    expect(usd("84754.5")).toBe("$84,754.50");
    expect(usd("-881.4", true)).toBe("−$881.40");
    expect(usd("130", true)).toBe("+$130.00");
    expect(percent("-1.18")).toBe("−1.18%");
    expect(amount("0.00005000")).toBe("0.00005");
    expect(usd(null)).toBe("–");
  });
});

describe("portfolio page", () => {
  it("shows the holdings and says when only part of the cost is known", async () => {
    vi.stubGlobal("fetch", reply(200, portfolio));
    render(<App />);
    expect(await screen.findByText("BNB")).toBeTruthy();
    expect(screen.getAllByText("$2,407.50").length).toBeGreaterThan(0);
    expect(screen.getByText("covers 2.5 of 3.75")).toBeTruthy();
    expect(screen.getByText(/Demo mode/)).toBeTruthy();
    expect(screen.getByText("No open orders.")).toBeTruthy();
    expect(screen.getByText(/ECB rate for 13 Nov/)).toBeTruthy();
    expect(screen.getByText("Demo data")).toBeTruthy();
  });

  it("shows the api's error with a way to try again", async () => {
    vi.stubGlobal(
      "fetch",
      reply(503, { error: "Add BINANCE_API_KEY and BINANCE_API_SECRET to .env." }),
    );
    render(<App />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/BINANCE_API_KEY/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("says when the api isn't running", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    render(<App />);
    expect(await screen.findByText(/api isn't running/)).toBeTruthy();
  });
});
