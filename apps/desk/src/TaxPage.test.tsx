import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaxPage from "./TaxPage";

// Made-up figures (known-mistakes 7).
vi.mock("./api", () => ({
  getTax: () =>
    Promise.resolve({
      fy: 2026,
      realisedGainsAud: "1200",
      realisedLossesAud: "-1500",
      discountedAud: "0",
      sales: 3,
      unknownSales: 0,
      next: null,
      lots: [],
      underWater: [],
    }),
  getStaking: () =>
    Promise.resolve({
      fy: 2026,
      fyAud: "1500",
      claims: [
        {
          id: 1,
          day: "2026-11-22",
          coin: "TAO",
          amount: "5",
          priceUsd: "200",
          audRate: "1.5",
          usd: "1000",
          aud: "1500",
          thisFy: true,
        },
      ],
    }),
  addStaking: vi.fn(),
  removeStaking: vi.fn(),
}));

afterEach(cleanup);

describe("the Tax page (owner, 22 Nov 2026)", () => {
  it("says the year in a sentence and lists staking income", async () => {
    render(<TaxPage />);
    const said = await screen.findByRole("heading", { level: 1 });
    await screen.findByText("TAO");
    expect(said.textContent).toContain("FY 2026");
    expect(said.textContent).toContain("A$300.00 net loss so far"); // 1,200 gains, 1,500 losses
    expect(said.textContent).toContain("staking income");
    expect(screen.getByRole("button", { name: "Add claim" })).toBeTruthy();
    expect(screen.getByText(/isn.t a sale/)).toBeTruthy();
  });
});
