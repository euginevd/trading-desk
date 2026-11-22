import { describe, expect, it } from "vitest";
import { combined } from "./Portfolio";
import type { Holding } from "./types";

const row = (over: Partial<Holding>): Holding => ({
  asset: "SOL",
  source: "Binance",
  amount: "1",
  price: "70",
  value: "70",
  change24h: "1",
  share: "1",
  averageCost: "60",
  covered: "1",
  profit: "10",
  profitPercent: "16.67",
  ...over,
});

describe("All adds each coin up across Binance and the Ledger (owner, 22 Nov 2026)", () => {
  it("joins a coin held in both into one row, cost weighted by what each part covers", () => {
    const [sol, btc] = combined([
      row({}),
      row({
        source: "Ledger",
        amount: "3",
        value: "210",
        averageCost: "80",
        covered: "3",
        profit: "-30",
        share: "3",
      }),
      row({ asset: "BTC", amount: "0.1", value: "6000" }),
    ]);
    expect(sol?.amount).toBe("4");
    expect(sol?.value).toBe("280");
    expect(sol?.share).toBe("4");
    expect(Number(sol?.averageCost)).toBe(75); // (1 x 60 + 3 x 80) / 4
    expect(sol?.profit).toBe("-20");
    expect(Number(sol?.profitPercent)).toBeCloseTo(-6.67, 2); // -20 on 300 paid
    expect(btc?.asset).toBe("BTC");
  });

  it("keeps an entered cost editable on the part it was entered for", () => {
    const [tao] = combined([
      row({ asset: "TAO", source: "Ledger", costEntered: true, value: "5000" }),
      row({ asset: "TAO", source: "Binance", value: "600" }),
    ]);
    expect(tao?.source).toBe("Ledger");
    expect(tao?.costEntered).toBe(true);
    expect(tao?.enteredCost).toBe("60"); // the editor gets the entered part's own cost
  });
});
