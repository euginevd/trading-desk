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

export function aud(value: string | null): string {
  return value === null ? "–" : `A$${money.format(Number(value))}`;
}

export function amount(value: string | null): string {
  return value === null ? "–" : coin.format(Number(value));
}

export function percent(value: string | null, signed = true): string {
  if (value === null) return "–";
  const n = Number(value);
  return `${sign(n, signed)}${money.format(Math.abs(n))}%`;
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
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TZ,
  });
  return `${day(d)}, ${time}`;
}

export function fetchedAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
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
