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
  weekly: "Weekly",
  named: "Named amount",
  "close-out": "Close-out",
  trim: "Trim",
  "buy-back": "Buy-back",
  desk: "From the desk",
  imported: "From Binance",
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
