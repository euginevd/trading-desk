// The what-if of adding to a position (decision 46), the same sums as the api's api/plan.py,
// so the owner can change the amount and see the result at once. Deterministic; no model.

export interface Holding {
  qty: number;
  avgCost: number | null;
  value: number;
}

// How far the price must rise to get back to the average cost; 0 if already above.
export function breakEven(avg: number | null, price: number): number | null {
  if (avg === null || !(price > 0)) return null;
  return Math.max(0, (avg / price - 1) * 100);
}

export interface WhatIf {
  newAvg: number | null;
  breakEvenBefore: number | null;
  breakEvenAfter: number | null;
  weightBefore: number;
  weightAfter: number;
  cashLeft: number;
}

// Adding `amount` at `price`: cash becomes coin, so the portfolio's total doesn't change.
export function whatIf(
  pos: Holding,
  price: number,
  amount: number,
  total: number,
  cash: number,
): WhatIf {
  const bought = price > 0 ? amount / price : 0;
  const qty = pos.qty + bought;
  const base = pos.avgCost !== null ? pos.avgCost * pos.qty : pos.value;
  const newAvg = qty > 0 ? (base + amount) / qty : null;
  return {
    newAvg,
    breakEvenBefore: breakEven(pos.avgCost, price),
    breakEvenAfter: breakEven(newAvg, price),
    weightBefore: total > 0 ? (pos.value / total) * 100 : 0,
    weightAfter: total > 0 ? ((pos.value + amount) / total) * 100 : 0,
    cashLeft: cash - amount,
  };
}

// A level's distance from the price, in words: "6.9% above", "0.6% below".
export function distance(level: number, price: number): string {
  if (!(price > 0)) return "";
  const away = ((level - price) / price) * 100;
  if (Math.abs(away) < 0.05) return "at the price";
  return `${Math.abs(away).toFixed(1)}% ${away > 0 ? "above" : "below"}`;
}
