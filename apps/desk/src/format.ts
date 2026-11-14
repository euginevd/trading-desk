// Locale rules from design-system 25: Australian English, money to 2 places, coins up to 8.
const TZ = "Australia/Sydney";

const money = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const coin = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 8 });

function sign(n: number, signed: boolean): string {
  if (n < 0) return "−";
  return signed && n > 0 ? "+" : "";
}

export function usd(value: string | null, signed = false): string {
  if (value === null) return "–";
  const n = Number(value);
  return `${sign(n, signed)}$${money.format(Math.abs(n))}`;
}

// A coin's price: 2 places from $1 up, more below so small prices stay readable.
export function price(value: string | null): string {
  if (value === null) return "–";
  const n = Number(value);
  const places = Math.abs(n) >= 1 ? 2 : 6;
  return n.toLocaleString("en-AU", {
    minimumFractionDigits: Math.min(places, 2),
    maximumFractionDigits: places,
  });
}

// The Dashboard's table, kept sleek (decision 26): whole dollars.
export function usdWhole(value: string | null, signed = false): string {
  if (value === null) return "–";
  const n = Math.round(Number(value));
  return `${sign(n, signed)}$${Math.abs(n).toLocaleString("en-AU")}`;
}

// A price with as few places as tell it apart: none from $100, 2 from $1, else 3 significant.
export function priceSleek(value: string | null): string {
  if (value === null) return "–";
  const n = Math.abs(Number(value));
  if (n >= 100) return Math.round(n).toLocaleString("en-AU");
  if (n >= 1)
    return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-AU", { maximumSignificantDigits: 3 });
}

// An amount to the fewest places whose last digit is worth $25 or less at this price, cut:
// BTC to 4 places, ETH to 2, TAO and SOL to 1, PUMP to none.
const AMOUNT_STEP_USD = 25;
export function amountSleek(value: string | null, at: string | null): string {
  if (value === null) return "–";
  const p = Number(at);
  const places = p > 0 ? Math.min(8, Math.max(0, Math.ceil(Math.log10(p / AMOUNT_STEP_USD)))) : 8;
  const n = Number(value);
  if (n > 0 && n < 10 ** -places) return `<${(10 ** -places).toString()}`;
  // Cut, not rounded, like an exchange shows a balance: never more than is held.
  const cut = Math.trunc(n * 10 ** places) / 10 ** places;
  return cut.toLocaleString("en-AU", { maximumFractionDigits: places });
}

// Large dollar figures in brief: $422.3M, $1.2B, $950K.
export function usdShort(value: string | null): string {
  if (value === null) return "–";
  const n = Number(value);
  const steps: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  const step = steps.find(([size]) => Math.abs(n) >= size);
  if (!step) return usd(value);
  return `$${(n / step[0]).toLocaleString("en-AU", { maximumFractionDigits: 1 })}${step[1]}`;
}

export function aud(value: string | null): string {
  return value === null ? "–" : `A$${money.format(Number(value))}`;
}

// Whole Australian dollars, signed: the PnL card.
export function audWhole(n: number): string {
  const r = Math.round(n);
  return `${sign(r, true)}A$${Math.abs(r).toLocaleString("en-AU")}`;
}

export function audSigned(n: number): string {
  return `${sign(n, true)}A$${money.format(Math.abs(n))}`;
}

export function amount(value: string | null): string {
  return value === null ? "–" : coin.format(Number(value));
}

// Percentages to 1 decimal place, kept sleek (the owner's choice).
const pct = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function percent(value: string | null, signed = true): string {
  if (value === null) return "–";
  const raw = Number(value);
  const n = Math.abs(raw) < 0.05 ? 0 : raw; // −0.0% reads as a loss
  return `${sign(n, signed)}${pct.format(Math.abs(n))}%`;
}

export function trend(value: string | null): "up" | "down" | "flat" {
  if (value === null || Number(value) === 0) return "flat";
  return Number(value) > 0 ? "up" : "down";
}

function day(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

export function dateTime(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
  return `${day(d)}, ${time}`;
}

export function fetchedAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
  return `${time}, ${day(d)}`;
}

export function shortDate(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: TZ,
  });
}
