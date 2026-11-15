import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Drift, JournalData, TaxReport } from "./types";

// Made-up figures only (known-mistakes 7).
const tax: TaxReport = {
  fy: "2026-27",
  realisedGainsAud: "750",
  realisedLossesAud: "-45",
  sales: 2,
  unknownSales: 0,
  discountedAud: "0",
  next: {
    coin: "ETH",
    bought: "2026-07-04",
    qty: "0.5",
    costAud: "1500",
    nowAud: "1950",
    gainAud: "450",
    heldDays: 134,
    qualifiesOn: "2027-07-05",
    daysToDiscount: 232,
  },
  lots: [
    {
      coin: "BTC",
      bought: null,
      qty: "0.01",
      costAud: null,
      nowAud: "1050",
      gainAud: null,
      heldDays: null,
      qualifiesOn: null,
      daysToDiscount: null,
    },
  ],
  underWater: [{ coin: "SOL", lossAud: "-375", afterAud: "330" }],
};
const drift: Drift = {
  band: "5",
  outside: 1,
  hasTargets: true,
  rows: [
    { coin: "ETH", targetPct: "25", nowPct: "23", outside: false, side: null },
    {
      coin: "TAO",
      targetPct: "20",
      nowPct: "41.4",
      outside: true,
      side: "sell",
      toTargetAud: "3180",
      orderAud: "500",
      price: "410",
      qty: "0.813",
      capped: true,
    },
  ],
};
const book: JournalData = {
  entries: [
    {
      key: "SOLUSDC:10",
      time: 1_794_000_000_000,
      coin: "SOL",
      side: "buy",
      qty: "4",
      price: "182",
      aud: "1092",
      from: "DCA-1 · D-12",
      resultAud: null,
      broke: ["Over per-trade size"],
      setups: [],
      mistakes: [],
    },
  ],
  score: {
    days: 30,
    trades: 3,
    kept: 1,
    keptPct: "33",
    mostBroken: [{ what: "Over per-trade size", times: 1 }],
    withMistakeAud: "0",
    withoutMistakeAud: "30",
  },
  lists: { setups: ["Support buy"], mistakes: ["FOMO"] },
};
const tagTrade = vi.fn((key: string, setups: string[], mistakes: string[]) =>
  Promise.resolve({ setups: key ? setups : [], mistakes }),
);

vi.mock("./api", () => ({
  getTax: () => Promise.resolve(tax),
  getDrift: () => Promise.resolve(drift),
  getJournal: () => Promise.resolve(book),
  tagTrade: (key: string, setups: string[], mistakes: string[]) => tagTrade(key, setups, mistakes),
  setJournalLists: (setups: string[], mistakes: string[]) => Promise.resolve({ setups, mistakes }),
}));

const { DriftCard, TaxTab } = await import("./Tax");
const { default: Journal } = await import("./Journal");

afterEach(cleanup);

describe("the Tax tab", () => {
  it("shows the year's gains, the next lot to qualify and what's under water", async () => {
    render(<TaxTab />);
    expect(await screen.findByText("A$750.00")).toBeTruthy();
    expect(screen.getByText("ETH · 232 days")).toBeTruthy();
    expect(screen.getByText("Age unknown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /BTC/ }));
    expect(screen.getByText("before 1 Jul 2026")).toBeTruthy();
    expect(screen.getByText(/wash sale/)).toBeTruthy();
    expect(screen.getByText(/not tax advice/)).toBeTruthy();
  });
});

describe("the drift card", () => {
  it("links an order back to target, within the per-trade size", async () => {
    render(<DriftCard />);
    const link = await screen.findByRole("link", { name: /Trim A\$500\.00/ });
    expect(link.getAttribute("href")).toBe(
      "#/trade?coin=TAO&side=sell&price=410&qty=0.813&why=rebalance",
    );
    expect(screen.getByText("In band")).toBeTruthy();
  });
});

describe("the Journal", () => {
  it("shows the score, the rules a trade broke, and tags it", async () => {
    render(<Journal />);
    expect(await screen.findByText("33%")).toBeTruthy();
    expect(screen.getAllByText("Over per-trade size").length).toBeGreaterThan(0);
    expect(screen.getByText("DCA-1 · D-12")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ tag" }));
    fireEvent.click(screen.getByRole("button", { name: "FOMO" }));
    expect(tagTrade).toHaveBeenCalledWith("SOLUSDC:10", [], ["FOMO"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "FOMO" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });
});
