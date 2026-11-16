// How the Profile shows money and dates (decision 58): a null or empty amount is "Not set".

const audFmt = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

export function audText(value: string | null, currency: "AUD" | "USD" | null = "AUD"): string {
  if (value === null || value === "") return "Not set";
  return `${currency === "USD" ? "US$" : "A$"}${audFmt.format(Number(value))}`;
}

export function dayText(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}

export function dayOf(ms: number): string {
  return new Date(ms).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}
