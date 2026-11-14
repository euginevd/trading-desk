import { describe, expect, it } from "vitest";
import { breakEven, distance, whatIf } from "./plan";

describe("plan sums", () => {
  it("works out break-even as the rise back to the average", () => {
    expect(breakEven(100, 80)).toBe(25); // 80 -> 100 is +25%
    expect(breakEven(80, 100)).toBe(0); // already above
    expect(breakEven(null, 100)).toBeNull();
  });

  it("matches a hand calculation for adding", () => {
    // 1 coin at an average of 100, now 80, worth 80 of a 1,000 portfolio with 600 cash.
    // Adding 400 at 80 buys 5 more: 6 coins for 500, an average of 83.33.
    const found = whatIf({ qty: 1, avgCost: 100, value: 80 }, 80, 400, 1000, 600);
    expect(found.newAvg).toBeCloseTo(83.3333, 4);
    expect(found.breakEvenBefore).toBe(25);
    expect(found.breakEvenAfter).toBeCloseTo(4.1667, 4); // 80 -> 83.33
    expect(found.weightBefore).toBe(8);
    expect(found.weightAfter).toBe(48); // (80 + 400) / 1,000
    expect(found.cashLeft).toBe(200);
  });

  it("starts a position from nothing", () => {
    const found = whatIf({ qty: 0, avgCost: null, value: 0 }, 50, 500, 10000, 2000);
    expect(found.newAvg).toBe(50);
    expect(found.breakEvenAfter).toBe(0);
    expect(found.weightAfter).toBe(5);
  });

  it("says how far a level is, in words", () => {
    expect(distance(71447, 66823)).toBe("6.9% above");
    expect(distance(66407, 66823)).toBe("0.6% below");
    expect(distance(100, 100)).toBe("at the price");
  });
});
