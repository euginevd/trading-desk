import {
  CandlestickSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { getWatchlist } from "./api";
import CoinIcon from "./CoinIcon";

// Shared by the DCA and grid bots and the ladder: the owner's watchlist coins, the Create bot
// menu, and a candlestick chart with the bot's price levels drawn on it.

// Every coin across the owner's watchlists, in list order, each once.
export function useWatchCoins(): string[] | null {
  const [coins, setCoins] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    getWatchlist().then(
      async (first) => {
        const others = await Promise.all(
          first.lists
            .filter((l) => l.id !== first.list.id && l.count > 0)
            .map((l) => getWatchlist(l.id).catch(() => null)),
        );
        const all = [first, ...others].flatMap((w) => (w ? w.coins.map((c) => c.coin) : []));
        if (live) setCoins([...new Set(all)]);
      },
      () => live && setCoins([]),
    );
    return () => {
      live = false;
    };
  }, []);
  return coins;
}

export function RobotIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="7" width="16" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 4v3M9 12h.01M15 12h.01M9.5 15.5h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="3.5" r="1" fill="currentColor" />
    </svg>
  );
}

// "Create bot" with a menu of the watchlist's coins; picking one opens the wizard on it.
export function CreateMenu({
  coins,
  onPick,
  label = "Create bot",
}: {
  coins: string[] | null;
  onPick: (coin: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div className="create-menu" ref={box}>
      <button
        type="button"
        className="btn btn-accent"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="create-list" role="menu" aria-label="Watchlist coins">
          {coins === null && <div className="muted create-empty">Loading your watchlist…</div>}
          {coins?.length === 0 && (
            <div className="muted create-empty">Add coins to your watchlist on the Trade page.</div>
          )}
          {coins?.map((coin) => (
            <button
              key={coin}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(coin);
              }}
            >
              <CoinIcon coin={coin} />
              {coin}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The coin picker inside a wizard: the watchlist's coins only.
export function CoinSelect({
  id,
  coins,
  value,
  onChange,
}: {
  id: string;
  coins: string[] | null;
  value: string;
  onChange: (coin: string) => void;
}) {
  const list = coins && !coins.includes(value) ? [value, ...coins] : (coins ?? [value]);
  return (
    <div className="in">
      <select
        id={id}
        className="coin-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {list.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface ChartCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
}

export interface Level {
  price: number;
  title: string;
  tone: "buy" | "sell" | "tp" | "sl" | "base" | "muted";
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const TONES: Record<Level["tone"], [string, string]> = {
  buy: ["--up", "#2ebd85"],
  sell: ["--down", "#f0616d"],
  tp: ["--up", "#2ebd85"],
  sl: ["--down", "#f0616d"],
  base: ["--accent", "#50d2c1"],
  muted: ["--muted", "#8c9aa3"],
};

// Candles with the bot's levels on top; the levels move as the settings change, and the scale
// always fits both the candles and every level.
export function BotChart({
  candles,
  levels,
  bands,
  label,
  height = 300,
}: {
  candles: ChartCandle[];
  levels: Level[];
  bands?: { t: number; lower: string | null; upper: string | null }[];
  label: string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lower = useRef<ISeriesApi<"Line"> | null>(null);
  const upper = useRef<ISeriesApi<"Line"> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const range = useRef<number[]>([]);

  useEffect(() => {
    if (!box.current) return;
    const grid = token("--line", "#1b272d");
    const made = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { color: token("--panel", "#0f171b") },
        textColor: token("--muted", "#8c9aa3"),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid },
      timeScale: { borderColor: grid, timeVisible: true },
    });
    series.current = made.addSeries(CandlestickSeries, {
      upColor: token("--up", "#2ebd85"),
      downColor: token("--down", "#f0616d"),
      wickUpColor: token("--up", "#2ebd85"),
      wickDownColor: token("--down", "#f0616d"),
      borderVisible: false,
      autoscaleInfoProvider: (
        base: () => { priceRange: { minValue: number; maxValue: number } } | null,
      ) => {
        const found = base();
        if (!found || range.current.length === 0) return found;
        return {
          ...found,
          priceRange: {
            minValue: Math.min(found.priceRange.minValue, ...range.current),
            maxValue: Math.max(found.priceRange.maxValue, ...range.current),
          },
        };
      },
    });
    const band = {
      color: token("--wait", "#e8b04b"),
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      lineStyle: LineStyle.Dotted,
    };
    lower.current = made.addSeries(LineSeries, band);
    upper.current = made.addSeries(LineSeries, { ...band, color: token("--dim", "#5e6c74") });
    chart.current = made;
    return () => {
      made.remove();
      chart.current = null;
      series.current = null;
      lines.current = [];
    };
  }, []);

  useEffect(() => {
    const at = (t: number) => Math.floor(t / 1000) as UTCTimestamp;
    series.current?.setData(
      candles.map((c) => ({ time: at(c.t), open: +c.o, high: +c.h, low: +c.l, close: +c.c })),
    );
    const pick = (key: "lower" | "upper") =>
      (bands ?? [])
        .filter((b) => b[key] !== null)
        .map((b) => ({ time: at(b.t), value: Number(b[key]) }));
    lower.current?.setData(pick("lower"));
    upper.current?.setData(pick("upper"));
    chart.current?.timeScale().fitContent();
  }, [candles, bands]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    for (const line of lines.current) s.removePriceLine(line);
    const labelled = levels.length <= 14;
    lines.current = levels.map((l) =>
      s.createPriceLine({
        price: l.price,
        color: token(...TONES[l.tone]),
        lineWidth: 1,
        lineStyle: l.tone === "base" || l.tone === "tp" ? LineStyle.Dashed : LineStyle.Dotted,
        axisLabelVisible: labelled,
        title: labelled ? l.title : "",
      }),
    );
    range.current = levels.map((l) => l.price);
    chart.current?.applyOptions({});
  }, [levels]);

  return <div ref={box} className="bot-chart" style={{ height }} role="img" aria-label={label} />;
}
