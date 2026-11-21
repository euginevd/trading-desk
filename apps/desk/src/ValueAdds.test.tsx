import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Drift, JournalData, JournalEntry, TaxReport } from "./types";

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
    const link = await screen.findByRole("link", { name: /^Trim A\$500/ });
    expect(link.getAttribute("href")).toBe(
      "#/dca-book?coin=TAO&rebalance=sell&price=410&qty=0.813",
    );
    expect(screen.getByText("In band")).toBeTruthy();
  });
});

describe("the Journal's ledger", () => {
  it("shows ten trades, then more on asking, and folds back", async () => {
    const one = book.entries[0] as JournalEntry;
    const kept = book.entries;
    book.entries = Array.from({ length: 34 }, (_, i) => ({ ...one, key: `SOLUSDC:${i}` }));
    render(<Journal />);
    const rows = () => document.querySelectorAll(".jr-ledger tbody tr").length;
    await screen.findByText("10 of 34");
    expect(rows()).toBe(10);
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(rows()).toBe(30);
    fireEvent.click(screen.getByRole("button", { name: "Show 4 more" }));
    expect(rows()).toBe(34);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(rows()).toBe(10);
    book.entries = kept;
  });
});

describe("the Journal", () => {
  it("shows the score, the rules a trade broke, and tags it", async () => {
    render(<Journal />);
    const hero = await screen.findByRole("region", { name: "Your last 30 days" });
    expect(hero.querySelector("h2")?.textContent).toBe(
      "1 of 3 trades kept every rule in the last 30 days (33%).",
    );
    expect(hero.querySelector("p")?.textContent).toBe(
      "Over per-trade size broke it most, 1 time. Realised with a mistake tag A$0, without A$30.",
    );
    expect(screen.getAllByText("Over per-trade size").length).toBeGreaterThan(0);
    // Broke a rule shows it; Kept shows nothing.
    const show = screen.getByRole("group", { name: "Show trades" });
    fireEvent.click(within(show).getByRole("button", { name: "Kept 0" }));
    expect(screen.getByText("No trade kept every rule.")).toBeTruthy();
    fireEvent.click(within(show).getByRole("button", { name: "Broke a rule 1" }));
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
