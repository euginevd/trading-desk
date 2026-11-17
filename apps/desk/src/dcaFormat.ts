// Small formatters and rules shared by the DCA widget and the DCA book page (TODO 11).
import type { DcaBook, DcaOrder } from "./types";

const AU = "en-AU";

// 1234.5 → "1,234.50"; null → "—".
export function two(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(AU, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Dollars as a person reads them: whole from $10 ("$49", "−$1,204"), cents below ("$0.11").
export function dollars(value: string | number | null | undefined, sign = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const body = abs.toLocaleString(AU, {
    minimumFractionDigits: abs >= 10 || abs === 0 ? 0 : 2,
    maximumFractionDigits: abs >= 10 ? 0 : 2,
  });
  const lead = n < 0 ? "−" : sign && n > 0 ? "+" : "";
  return `${lead}$${body}`;
}

// "+12.40" or "−3.10", with a real minus sign.
export function signed(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${two(Math.abs(n))}`;
}

// A coin quantity: up to 8 places, trailing zeros dropped (design-system 18).
export function qty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString(AU, { maximumFractionDigits: 8 });
}

// A price: 2 places from 1 up, more for small coins, never rounded onto a round number.
export function limit(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return n.toLocaleString(AU, { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 6 : 2 });
}

// 13 Nov, 13 Nov 2026 when asked.
export function day(ms: number, withYear = false): string {
  return new Date(ms).toLocaleDateString(AU, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "Australia/Sydney",
  });
}

// "20 Nov (Fri)", Sydney time; with the time, "20 Nov (Fri) 5pm".
export function dated(ms: number, withTime = false): string {
  const at = new Date(ms);
  const date = at.toLocaleDateString(AU, {
    day: "numeric",
    month: "short",
    timeZone: "Australia/Sydney",
  });
  const weekday = at.toLocaleDateString(AU, { weekday: "short", timeZone: "Australia/Sydney" });
  return `${date} (${weekday})${withTime ? ` ${when(ms).split(" ")[1] ?? ""}` : ""}`;
}

// "Mon 7pm", Sydney time.
export function when(ms: number): string {
  const at = new Date(ms);
  const weekday = at.toLocaleDateString(AU, { weekday: "short", timeZone: "Australia/Sydney" });
  const time = at
    .toLocaleTimeString(AU, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Australia/Sydney",
    })
    .replace(":00", "")
    .replace(/\s/g, "")
    .toLowerCase();
  return `${weekday} ${time}`;
}

export const SOURCE: Record<DcaOrder["source"], string> = {
  weekly: "Weekly plan",
  named: "Extra funds",
  "close-out": "Monday buy",
  trim: "Trim",
  "buy-back": "Buy-back",
  desk: "By hand",
  imported: "From Binance",
};

// What each source means, for its tooltip.
export const SOURCE_WHY: Record<DcaOrder["source"], string> = {
  weekly: "This week's plan, as a limit order",
  named: "Extra money you added with Add funds, placed by dca-agent's plan",
  "close-out": "Monday's market buy of what the week's limits didn't fill",
  trim: "Part of the position sold when it ran hot, to buy back lower",
  "buy-back": "Buying back what a trim sold, at a lower price",
  desk: "An order you placed yourself on the desk",
  imported: "Found on Binance and added to the book",
};

export const STATUS: Record<DcaOrder["status"], string> = {
  placing: "Placing",
  open: "Open",
  filled: "Filled",
  cancelled: "Cancelled",
};

export const weeklyTotal = (book: DcaBook): number =>
  (book.plan?.orders ?? []).reduce((sum, o) => sum + Number(o.spend), 0);

export const isOpen = (o: DcaOrder) => o.status === "open" || o.status === "placing";

// What the order spent or raised: the fill if any, else what it was placed for.
export function amountOf(o: DcaOrder): string {
  if (Number(o.filledQuote) > 0) return o.filledQuote;
  return o.spend ?? (o.qty && o.price ? String(Number(o.qty) * Number(o.price)) : "0");
}

// Every order as CSV, for the accountant; quotes guard commas and formulas.
export function toCsv(orders: DcaOrder[], quote: string): string {
  const cell = (v: string | number | null) => {
    const text = v === null ? "" : String(v);
    return /^[=+\-@]/.test(text) || /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = [
    "Reference",
    "Placed",
    "Coin",
    "Side",
    "Kind",
    "Source",
    "Linked to",
    "Status",
    "Limit price",
    "Filled quantity",
    `Filled ${quote}`,
    "Average price",
    `Fee (${quote})`,
  ];
  const rows = orders.map((o) => [
    o.ref,
    new Date(o.created).toISOString(),
    o.coin,
    o.side,
    o.kind,
    o.source,
    o.link,
    o.status,
    o.price,
    o.filledQty,
    o.filledQuote,
    o.avgPrice,
    o.fee,
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
