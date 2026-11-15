// The Profile's fields (decision 58), the same as the api's (apps/api/src/api/profile.py): what
// each card shows and edits. A null or empty value shows as "Not set".
import type { ProfileDoc, ProfileSection } from "./types";

export type Kind =
  | "text"
  | "long"
  | "money"
  | "pct"
  | "num"
  | "year"
  | "date"
  | "choice"
  | "texts"
  | "targets"
  | "bool";
export interface FieldSpec {
  key: string;
  label: string;
  kind: Kind;
  choices?: string[];
}

export type RecordSection = "identity" | "income" | "foundations" | "strategy" | "rules";
export type ListSection = "goals" | "holdings" | "lessons" | "quotes";

export const TITLES: Record<ProfileSection, string> = {
  identity: "Identity",
  income: "Income",
  goals: "Goals",
  foundations: "Foundations",
  strategy: "Strategy",
  rules: "Rules",
  holdings: "Holdings",
  lessons: "Lessons",
  quotes: "Quotes",
  additional_info: "Additional info",
};
export const SECTIONS = Object.keys(TITLES) as ProfileSection[];

export const RECORDS: Record<RecordSection, FieldSpec[]> = {
  identity: [
    { key: "name", label: "Name", kind: "text" },
    { key: "date_of_birth", label: "Date of birth", kind: "date" },
  ],
  income: [
    { key: "gross_monthly_aud", label: "Earnings a month", kind: "money" },
    { key: "after_tax_monthly_aud", label: "After tax a month", kind: "money" },
    { key: "living_monthly_aud", label: "Living costs a month", kind: "money" },
    { key: "available_monthly_aud", label: "Available to invest a month", kind: "money" },
    { key: "notes", label: "Notes", kind: "long" },
  ],
  foundations: [
    { key: "emergency_fund_aud", label: "Emergency fund", kind: "money" },
    { key: "emergency_months", label: "Emergency fund (months)", kind: "num" },
    { key: "parked_funds_aud", label: "Parked funds", kind: "money" },
    { key: "min_cash_aud", label: "Minimum cash", kind: "money" },
    { key: "insurance", label: "Insurance", kind: "texts" },
    {
      key: "health_cover_status",
      label: "Health cover",
      kind: "choice",
      choices: ["none", "parked", "active"],
    },
    { key: "health_cover_monthly_aud", label: "Health cover a month", kind: "money" },
    { key: "debt", label: "Debt", kind: "text" },
    { key: "wills", label: "Wills", kind: "text" },
  ],
  strategy: [
    { key: "text", label: "Strategy", kind: "long" },
    { key: "focus", label: "Focus", kind: "text" },
    { key: "targets", label: "Target allocation", kind: "targets" },
  ],
  rules: [
    { key: "monthly_deposit_cap_aud", label: "Monthly deposit cap", kind: "money" },
    {
      key: "deposit_cadence",
      label: "Deposit cadence",
      kind: "choice",
      choices: ["weekly", "fortnightly", "monthly"],
    },
    { key: "max_pct_per_coin", label: "Max % per coin", kind: "pct" },
    { key: "per_trade_aud", label: "Per-trade size", kind: "money" },
    { key: "max_loss_pct", label: "Max loss a position", kind: "pct" },
    { key: "rebalance_band", label: "Rebalance band (± points)", kind: "num" },
    { key: "take_profit_rule", label: "Take-profit rule", kind: "long" },
    { key: "entry_strategy", label: "Entry strategy", kind: "long" },
    { key: "behaviour_rules", label: "Behaviour rules", kind: "texts" },
  ],
};

export const LISTS: Record<ListSection, FieldSpec[]> = {
  goals: [
    { key: "label", label: "Goal", kind: "text" },
    { key: "amount", label: "Amount", kind: "money" },
    { key: "currency", label: "Currency", kind: "choice", choices: ["AUD", "USD"] },
    { key: "date", label: "By", kind: "date" },
    { key: "then_rule", label: "Then", kind: "text" },
  ],
  holdings: [
    { key: "name", label: "Holding", kind: "text" },
    {
      key: "source",
      label: "Value from",
      kind: "choice",
      choices: ["binance", "taostats", "manual"],
    },
    { key: "invested_aud", label: "Invested", kind: "money" },
    { key: "value_aud", label: "Value (manual only)", kind: "money" },
    { key: "cash", label: "Counts as cash", kind: "bool" },
    { key: "counts", label: "Counts toward goals", kind: "bool" },
  ],
  lessons: [
    { key: "year", label: "Year", kind: "year" },
    { key: "text", label: "Lesson", kind: "long" },
  ],
  quotes: [
    { key: "text", label: "Quote", kind: "long" },
    { key: "author", label: "By", kind: "text" },
  ],
};

export const CHOICE_WORDS: Record<string, string> = {
  none: "None",
  parked: "Parked for later",
  active: "Active",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  binance: "Binance (live)",
  taostats: "TAO wallet (live)",
  manual: "Typed in",
  AUD: "A$",
  USD: "US$",
};

export const isRecord = (s: ProfileSection): s is RecordSection => s in RECORDS;
export const isList = (s: ProfileSection): s is ListSection => s in LISTS;

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

export function isUnset(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

// How one field reads on a card and in a comparison.
export function shown(f: FieldSpec, value: unknown): string {
  if (f.kind === "bool") return value ? "Yes" : "No";
  if (isUnset(value)) return "Not set";
  switch (f.kind) {
    case "money":
      return audText(String(value));
    case "pct":
      return `${String(value)}%`;
    case "date":
      return dayText(String(value));
    case "choice":
      return CHOICE_WORDS[String(value)] ?? String(value);
    case "texts":
      return (value as string[]).join("; ");
    case "targets":
      return (value as { coin: string; pct: string }[])
        .map((t) => `${t.coin} ${t.pct}%`)
        .join(", ");
    default:
      return String(value);
  }
}

// Every field of a document as label and words, for comparing two versions.
export function flatten(doc: ProfileDoc): { key: string; label: string; text: string }[] {
  const rows: { key: string; label: string; text: string }[] = [];
  for (const section of SECTIONS) {
    if (isRecord(section)) {
      const data = doc[section] as unknown as Record<string, unknown>;
      for (const f of RECORDS[section]) {
        rows.push({
          key: `${section}.${f.key}`,
          label: `${TITLES[section]} · ${f.label}`,
          text: shown(f, data[f.key]),
        });
      }
    } else if (isList(section)) {
      const items = doc[section] as unknown as Record<string, unknown>[];
      rows.push({
        key: section,
        label: TITLES[section],
        text: items.length
          ? items
              .map((item) => LISTS[section].map((f) => shown(f, item[f.key])).join(" · "))
              .join("\n")
          : "Not set",
      });
    } else {
      rows.push({ key: section, label: TITLES[section], text: doc.additional_info || "Not set" });
    }
  }
  const locks = Object.entries(doc.locks)
    .filter(([, on]) => on)
    .map(([k]) => k.replace("_", " "));
  rows.push({ key: "locks", label: "Locked", text: locks.join(", ") || "None" });
  return rows;
}
