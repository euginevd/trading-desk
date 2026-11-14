// The Dashboard's display currency (decision 30): AUD, USD, INR or BTC. The api values everything
// in US dollars and sends each currency's units per dollar; the desk converts and formats here.

export type Currency = "AUD" | "USD" | "INR" | "BTC";
export const CURRENCIES: Currency[] = ["AUD", "USD", "INR", "BTC"];

const SYMBOL: Record<Currency, string> = { AUD: "A$", USD: "$", INR: "₹", BTC: "₿" };
const LOCALE: Record<Currency, string> = {
  AUD: "en-AU",
  USD: "en-AU",
  INR: "en-IN",
  BTC: "en-AU",
};

export type Money = {
  currency: Currency;
  rate: number; // units of the currency per US dollar
  full: (usd: number | string | null, signed?: boolean) => string;
  whole: (usd: number | string | null, signed?: boolean) => string;
  price: (usd: number | string | null) => string;
};

function sign(n: number, signed: boolean): string {
  if (n < 0) return "−";
  return signed && n > 0 ? "+" : "";
}

// Picks the currency if the api sent its rate, else US dollars.
export function money(asked: Currency, rates: Partial<Record<string, string>> | undefined): Money {
  const raw = asked === "USD" ? 1 : Number(rates?.[asked]);
  const currency: Currency = raw > 0 ? asked : "USD";
  const rate = raw > 0 ? raw : 1;
  const locale = LOCALE[currency];
  const fmt = (n: number, options: Intl.NumberFormatOptions) =>
    Math.abs(n).toLocaleString(locale, options);
  const convert = (usd: number | string | null) => (usd === null ? null : Number(usd) * rate);

  // Bitcoin amounts: 8 places at most, but only as many significant digits as matter.
  const btc = (n: number) =>
    fmt(n, Math.abs(n) >= 1 ? { maximumFractionDigits: 4 } : { maximumSignificantDigits: 4 });

  return {
    currency,
    rate,
    full: (usd, signed = false) => {
      const n = convert(usd);
      if (n === null) return "–";
      const body =
        currency === "BTC"
          ? btc(n)
          : fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${sign(n, signed)}${SYMBOL[currency]}${body}`;
    },
    whole: (usd, signed = false) => {
      const n = convert(usd);
      if (n === null) return "–";
      const body = currency === "BTC" ? btc(n) : fmt(Math.round(n), {});
      const shown = currency === "BTC" ? n : Math.round(n);
      return `${sign(shown, signed)}${SYMBOL[currency]}${body}`;
    },
    // A coin's price as sleek as the table's (decision 26), in the chosen currency.
    price: (usd) => {
      const n = convert(usd);
      if (n === null) return "–";
      const a = Math.abs(n);
      let body: string;
      if (currency === "BTC") body = fmt(a, { maximumSignificantDigits: 3 });
      else if (a >= 100) body = fmt(Math.round(a), {});
      else if (a >= 1) body = fmt(a, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      else body = fmt(a, { maximumSignificantDigits: 3 });
      return `${SYMBOL[currency]}${body}`;
    },
  };
}
