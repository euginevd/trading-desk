import { priceSleek } from "./format";
import { distance } from "./plan";
import type { Market } from "./types";

// The few levels that matter when entering a trade, as a quiet strip over the chart: the
// nearest ceiling above the price and the nearest floor below it (from resistance, support and
// yesterday's and last week's highs and lows), and the day and week opens, which say whether
// today and this week are up or down. Anything more than 10% away is left out.

const NEAR = 10; // %
const NAMES: Record<string, string> = {
  "Week open": "Week open",
  "Day open": "Day open",
  "Prev week high": "Last week's high",
  "Prev week low": "Last week's low",
  "Prev day high": "Yesterday's high",
  "Prev day low": "Yesterday's low",
  Support: "Support",
  Resistance: "Resistance",
};
const CEILINGS = ["Resistance", "Prev day high", "Prev week high"];
const FLOORS = ["Support", "Prev day low", "Prev week low"];

interface Lv {
  name: string;
  value: number;
  price: string;
}

export function entryLevels(market: Market): Lv[] {
  const now = Number(market.price);
  if (!(now > 0)) return [];
  const all: Lv[] = [
    ...(market.levels ?? []),
    ...(market.indicators.support ? [{ name: "Support", price: market.indicators.support }] : []),
    ...(market.indicators.resistance
      ? [{ name: "Resistance", price: market.indicators.resistance }]
      : []),
  ]
    .map((l) => ({ ...l, value: Number(l.price) }))
    .filter((l) => l.value > 0 && Math.abs((l.value - now) / now) * 100 <= NEAR);
  const nearest = (names: string[], above: boolean) =>
    all
      .filter((l) => names.includes(l.name) && (above ? l.value > now : l.value <= now))
      .sort((a, b) => Math.abs(a.value - now) - Math.abs(b.value - now))[0];
  const picked = [
    nearest(CEILINGS, true),
    nearest(FLOORS, false),
    all.find((l) => l.name === "Week open"),
    all.find((l) => l.name === "Day open"),
  ].filter((l): l is Lv => l !== undefined);
  return [...new Map(picked.map((l) => [l.name, l])).values()].sort((a, b) => b.value - a.value);
}

export default function KeyLevels({ market }: { market: Market }) {
  const now = Number(market.price);
  const levels = entryLevels(market);
  if (levels.length === 0) return null;
  const chip = (l: Lv) => {
    const away = ((l.value - now) / now) * 100;
    const open = l.name.endsWith("open");
    const hint = open
      ? `${away > 0 ? "Below" : "Above"} the ${l.name.toLowerCase()}: ${l.name.startsWith("Week") ? "this week" : "today"} is ${away > 0 ? "down" : "up"}`
      : `${away > 0 ? "Nearest ceiling" : "Nearest floor"}, ${Math.abs(away).toFixed(1)}% away`;
    return (
      <li key={l.name} className={l.value > now ? "above" : "below"} title={hint}>
        <span>{NAMES[l.name] ?? l.name}</span> <b>{priceSleek(l.price)}</b>{" "}
        <em>· {distance(l.value, now)}</em>
      </li>
    );
  };
  return (
    <ul className="key-levels" aria-label="Key levels">
      {levels.filter((l) => l.value > now).map(chip)}
      <li className="now">
        <span>Now</span> <b>{priceSleek(market.price)}</b>
      </li>
      {levels.filter((l) => l.value <= now).map(chip)}
    </ul>
  );
}
