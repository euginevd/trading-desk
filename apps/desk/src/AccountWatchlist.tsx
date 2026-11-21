// The Trading account's watchlist, at the foot of the page and folded away when not wanted: a
// table row per coin (price, day, 30 days, its line, the one thing to do about it and what's
// held), sorted by any column like the Portfolio's, coins in a trade first until then, Edit to add
// or remove coins, and a panel per coin with its daily chart, the desk's read and, when asked,
// trading-agent's (one model call per ask), then New trade on it.
import { useCallback, useEffect, useRef, useState } from "react";
import { analysePotCoin, getAccountCoins, getMarket, unwatchCoin, watchCoin } from "./api";
import { errorOf } from "./format";
import { type Average, BotChart, type Level } from "./BotKit";
import CoinIcon from "./CoinIcon";
import { day, dollars, limit, roundPrice } from "./dcaFormat";
import type { AccountCoin, Interval, Market, PotAnalysis } from "./types";

const OPEN_KEY = "desk.account.watchlist";
// Moves in whole percent ("−21%"): a watchlist is read at a glance.
const signed = (v: number) => `${Math.round(v) > 0 ? "+" : ""}${Math.round(v)}%`;
const toneOf = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "");

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

// A coin's place in the list until a header is clicked: in a trade, proposed, worth an
// Analyse, waiting, then the coins with no setup.
const TAGS = ["trade", "proposed", "watch", "wait", "none"] as const;
const tagOf = (c: AccountCoin): (typeof TAGS)[number] =>
  c.inTrade ? "trade" : c.watching ? "proposed" : (c.insight?.status ?? "none");

// The table's order: by tag until a header is clicked, then by that column; figures high to
// low on the first click, the coin A to Z.
type SortKey = "tag" | "coin" | "price" | "day" | "week" | "month" | "high" | "cap";
const figure = (c: AccountCoin, key: SortKey): number | string | null => {
  switch (key) {
    case "tag":
      return TAGS.indexOf(tagOf(c));
    case "coin":
      return c.coin;
    case "price":
      return Number(c.price);
    case "day":
      return Number(c.change24hPct);
    case "week":
      return c.change7dPct == null ? null : Number(c.change7dPct);
    case "high":
      return c.fromHighPct == null ? null : Number(c.fromHighPct);
    case "month":
      return c.change30dPct === null ? null : Number(c.change30dPct);
    case "cap":
      return c.marketCap ? Number(c.marketCap) : null;
  }
};
const SORT_KEY = "desk.account.watchlist.sort";
const KEYS: SortKey[] = ["tag", "coin", "price", "day", "week", "month", "high", "cap"];
// A market cap in round figures: $1.2T, $45B, $820M.
function cap(value: string | null | undefined): string {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0) return "—";
  const [div, unit] = n >= 1e12 ? [1e12, "T"] : n >= 1e9 ? [1e9, "B"] : [1e6, "M"];
  const v = n / div;
  return `$${v >= 10 ? Math.round(v) : v.toFixed(1)}${unit}`;
}
function readSort(): { key: SortKey; down: boolean } {
  try {
    const v = JSON.parse(window.localStorage.getItem(SORT_KEY) ?? "null") as {
      key?: SortKey;
      down?: boolean;
    } | null;
    if (v && v.key && KEYS.includes(v.key)) return { key: v.key, down: Boolean(v.down) };
  } catch {
    // unreadable: the default
  }
  return { key: "tag", down: false };
}
function keepSort(sort: { key: SortKey; down: boolean }) {
  try {
    window.localStorage.setItem(SORT_KEY, JSON.stringify(sort));
  } catch {
    // not kept: the default next time
  }
}

function sorted(coins: AccountCoin[], key: SortKey, down: boolean): AccountCoin[] {
  return [...coins].sort((a, b) => {
    const x = figure(a, key);
    const y = figure(b, key);
    if (x === null || y === null || Number.isNaN(x) || Number.isNaN(y)) {
      const xNone = x === null || Number.isNaN(x);
      const yNone = y === null || Number.isNaN(y);
      return xNone === yNone ? 0 : xNone ? 1 : -1;
    }
    const order = typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y);
    return order * (down ? -1 : 1);
  });
}

function Spark({ closes }: { closes: string[] }) {
  if (closes.length < 2) return null;
  const v = closes.map(Number);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pts = v
    .map(
      (c, i) =>
        `${(i / (v.length - 1)) * 100},${hi === lo ? 15 : 28 - ((c - lo) / (hi - lo)) * 26}`,
    )
    .join(" ");
  const up = (v.at(-1) ?? 0) >= (v[0] ?? 0);
  return (
    <svg
      className={`acc-spark ${up ? "up" : "down"}`}
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={pts} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function AccountWatchlist({
  version,
  onTrade,
}: {
  version: number;
  onTrade: (coin: string) => void;
}) {
  const [open, setOpen] = useState(readOpen);
  const [coins, setCoins] = useState<AccountCoin[] | null>(null);
  const [list, setList] = useState<{ id: number; max: number } | null>(null);
  const [quote, setQuote] = useState("USDC");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [sort, setSortNow] = useState(readSort);
  const setSort = (next: (s: { key: SortKey; down: boolean }) => { key: SortKey; down: boolean }) =>
    setSortNow((s) => {
      const v = next(s);
      keepSort(v);
      return v;
    });
  const sortable = (key: SortKey, label: string, right = true) => (
    <th
      className={right ? "r" : undefined}
      aria-sort={sort.key === key ? (sort.down ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        className="sort-btn"
        onClick={() =>
          setSort((s) => ({
            key,
            down: s.key === key ? !s.down : key !== "coin" && key !== "tag",
          }))
        }
      >
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.down ? " ↓" : " ↑") : ""}</span>
      </button>
    </th>
  );

  // Daily candles: read once, after each scan and after an edit, never on a timer.
  const load = useCallback(() => {
    getAccountCoins().then(
      (c) => {
        setCoins(c.coins);
        setList({ id: c.list, max: c.max });
        setQuote(c.quote);
        setError(null);
      },
      (e: unknown) => setError(errorOf(e, "The watchlist couldn't be read.")),
    );
  }, []);
  useEffect(() => load(), [load, version]);

  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      } catch {
        // not kept: open next time
      }
      return !o;
    });
  const change = (act: () => Promise<unknown>) => {
    setBusy(true);
    act().then(
      () => {
        setBusy(false);
        setAdding("");
        load();
      },
      (e: unknown) => {
        setBusy(false);
        setError(errorOf(e, "The watchlist wasn't changed."));
      },
    );
  };
  const add = () => {
    const coin = adding.trim().toUpperCase();
    if (coin && list) change(() => watchCoin(coin, list.id));
  };
  const shown = coins?.find((c) => c.coin === viewing) ?? null;
  const ready = coins?.filter((c) => c.insight?.status === "watch").length ?? 0;
  // Every coin on the folded line, the biggest fall first.
  const byDay = [...(coins ?? [])].sort((a, b) => Number(a.change24hPct) - Number(b.change24hPct));

  return (
    <section
      className={`dcb-section acc-watch${open ? "" : " is-folded"}`}
      aria-labelledby="acc-watch-title"
    >
      <div className="dcb-section-head">
        <button
          type="button"
          className="acc-fold"
          aria-expanded={open}
          aria-controls="acc-watch-body"
          onClick={toggle}
        >
          <h2 id="acc-watch-title">Watchlist</h2>
          <span className="fold-sum num" hidden={open}>
            {coins === null ? (
              "Reading…"
            ) : (
              <>
                <span className="fold-chip">
                  {coins.length} {coins.length === 1 ? "coin" : "coins"}
                </span>
                {byDay.map((c) => (
                  <span key={c.coin} className={`fold-chip ${toneOf(Number(c.change24hPct))}`}>
                    {c.coin} {signed(Number(c.change24hPct))}
                  </span>
                ))}
                {ready > 0 && <span className="fold-chip up">{ready} worth an Analyse</span>}
              </>
            )}
          </span>
        </button>
        {open && list && (
          <button type="button" className="link" onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      {open && (
        <div id="acc-watch-body">
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {editing && list && coins && (
            <div className="acc-edit" role="group" aria-label="Edit the watchlist">
              {coins.map((c) => (
                <span key={c.coin} className="acc-chip">
                  <CoinIcon coin={c.coin} />
                  {c.coin}
                  <button
                    type="button"
                    aria-label={`Remove ${c.coin}`}
                    disabled={busy}
                    onClick={() => change(() => unwatchCoin(c.coin, list.id))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {coins.length < list.max ? (
                <form
                  className="acc-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    add();
                  }}
                >
                  <input
                    aria-label="Coin to add"
                    placeholder="Add a coin, e.g. LINK"
                    value={adding}
                    maxLength={12}
                    onChange={(e) => setAdding(e.target.value)}
                  />
                  <button type="submit" className="btn" disabled={busy || !adding.trim()}>
                    Add
                  </button>
                </form>
              ) : (
                <span className="muted">Full at {list.max}: remove one to add another.</span>
              )}
            </div>
          )}
          {coins !== null && coins.length === 0 && (
            <p className="muted">Nothing on the watchlist. Edit adds a coin.</p>
          )}
          {coins && coins.length > 0 && (
            <div className="dcb-scroll">
              <table className="dcb-table acc-table" aria-label="Watchlist coins">
                <thead>
                  <tr>
                    {sortable("coin", "Coin", false)}
                    {sortable("price", "Price")}
                    {sortable("day", "24h")}
                    {sortable("week", "7 days")}
                    {sortable("month", "30 days")}
                    <th className="acc-th-spark">30-day chart</th>
                    {sortable("high", "From 30d high")}
                    {sortable("cap", "Market cap")}
                  </tr>
                </thead>
                <tbody>
                  {sorted(coins, sort.key, sort.down).map((c) => {
                    const day = Number(c.change24hPct);
                    const month = c.change30dPct === null ? null : Number(c.change30dPct);
                    return (
                      <tr key={c.coin} className="dcb-row-open">
                        <td>
                          <button
                            type="button"
                            className="dcb-expand"
                            onClick={() => setViewing(c.coin)}
                            aria-label={`${c.coin}: ${c.insight?.setup ?? "no read yet"} Open its chart`}
                          >
                            <span className="dcb-coin">
                              <CoinIcon coin={c.coin} />
                              {c.coin}
                            </span>
                          </button>
                        </td>
                        <td className="r num">{roundPrice(c.price)}</td>
                        <td className={`r num ${toneOf(day)}`}>{signed(day)}</td>
                        <td
                          className={`r num ${c.change7dPct == null ? "" : toneOf(Number(c.change7dPct))}`}
                        >
                          {c.change7dPct == null ? "—" : signed(Number(c.change7dPct))}
                        </td>
                        <td className={`r num ${month === null ? "" : toneOf(month)}`}>
                          {month === null ? "—" : signed(month)}
                        </td>
                        <td className="acc-td-spark">
                          <Spark closes={c.spark} />
                        </td>
                        <td className="r num muted">
                          {c.fromHighPct == null ? "—" : signed(Number(c.fromHighPct))}
                        </td>
                        <td className="r num">{cap(c.marketCap)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {shown && (
        <CoinDrawer
          key={shown.coin}
          coin={shown}
          quote={quote}
          onClose={() => setViewing(null)}
          onTrade={() => {
            setViewing(null);
            onTrade(shown.coin);
          }}
        />
      )}
    </section>
  );
}

// The timeframes the panel offers; daily is what trading-agent's rules read (trend, levels,
// the 20-, 50- and 200-day), 4h times an entry, 1h shows the last few days up close.
const TIMEFRAMES: [Interval, string][] = [
  ["1h", "1h"],
  ["4h", "4h"],
  ["1d", "1D"],
];
const TF_NAME: Record<Interval, string> = {
  "15m": "15-minute",
  "1h": "hourly",
  "4h": "4-hour",
  "1d": "daily",
};
const TF_UNIT: Record<Interval, string> = {
  "15m": "15 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day",
};
const TF_WHY: Record<Interval, string> = {
  "15m": "Noise for a swing trade.",
  "1h": "The last few days up close: where an order fills.",
  "4h": "Timing an entry inside the daily setup.",
  "1d": "What trading-agent's rules read: the trend and the levels.",
};
const averagesOf = (tf: Interval): Average[] => {
  const unit = tf === "1d" ? "-day" : ` × ${tf}`;
  return [
    { n: 20, title: `20${unit}`, color: ["--accent", "#50d2c1"] },
    { n: 50, title: `50${unit}`, color: ["--wait", "#e8b04b"] },
  ];
};
function caption(tf: Interval, candles: Market["candles"]): string {
  const first = candles[0]?.t ?? 0;
  const last = candles.at(-1)?.t ?? 0;
  return `${candles.length} ${TF_NAME[tf]} candles, each ${TF_UNIT[tf]}: ${day(first)} to ${day(last)}. Lines: 20 and 50 averages, support and resistance from the daily and weekly swings. Bars along the foot: volume.`;
}

const VERDICT: Record<PotAnalysis["verdict"], string> = {
  take: "Take",
  wait: "Wait",
  pass: "Pass",
};

function CoinDrawer({
  coin,
  quote,
  onClose,
  onTrade,
}: {
  coin: AccountCoin;
  quote: string;
  onClose: () => void;
  onTrade: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);
  const [market, setMarket] = useState<Market | null>(null);
  const [tf, setTf] = useState<Interval>("1d");
  const [read, setRead] = useState<PotAnalysis | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let on = true;
    if (coin.source === "futures") return; // no spot pair to chart
    getMarket(`${coin.coin}${quote}`, tf).then(
      (m) => on && setMarket(m),
      () => on && setMarket(null),
    );
    return () => {
      on = false;
    };
  }, [coin.coin, coin.source, quote, tf]);

  const ask = () => {
    setAsking(true);
    setError("");
    analysePotCoin({ coin: coin.coin }).then(
      (a) => {
        setAsking(false);
        setRead(a);
      },
      (e: unknown) => {
        setAsking(false);
        setError(errorOf(e, "trading-agent couldn't be reached."));
      },
    );
  };
  const ind = market?.indicators;
  const levels: Level[] = [
    ...(ind?.support
      ? [{ price: Number(ind.support), title: "Support", tone: "buy" as const }]
      : []),
    ...(ind?.resistance
      ? [{ price: Number(ind.resistance), title: "Resistance", tone: "sell" as const }]
      : []),
    ...(read?.plan
      ? [
          { price: Number(read.plan.entry), title: "Entry", tone: "base" as const },
          { price: Number(read.plan.stop), title: "Stop", tone: "sl" as const },
          { price: Number(read.plan.target), title: "Target", tone: "tp" as const },
        ]
      : []),
  ].filter((l) => l.price > 0);
  const day = Number(coin.change24hPct);
  const month = coin.change30dPct === null ? null : Number(coin.change30dPct);

  return (
    <dialog
      ref={dialog}
      className="dcb-drawer acc-drawer"
      aria-labelledby="acc-drawer-title"
      onClose={onClose}
    >
      <header className="dcb-drawer-head">
        <h2 id="acc-drawer-title">
          <span className="dcb-coin">
            <CoinIcon coin={coin.coin} />
            {coin.coin}
          </span>
        </h2>
        <button
          type="button"
          className="link dcb-drawer-close"
          onClick={() => dialog.current?.close?.()}
        >
          Close
        </button>
      </header>
      <div className="dcb-drawer-figures">
        <div>
          <small>Price</small>
          <b className="num">{limit(coin.price)}</b>
        </div>
        <div>
          <small>Day</small>
          <b className={`num ${toneOf(day)}`}>{signed(day)}</b>
        </div>
        <div>
          <small>30 days</small>
          <b className={`num ${month === null ? "" : toneOf(month)}`}>
            {month === null ? "—" : signed(month)}
          </b>
        </div>
        <div>
          <small>Held</small>
          <b className="num">{Number(coin.value) > 0 ? dollars(coin.value) : "—"}</b>
        </div>
      </div>
      <div className="acc-tf" role="group" aria-label="Timeframe">
        {TIMEFRAMES.map(([key, name]) => (
          <button key={key} type="button" aria-pressed={tf === key} onClick={() => setTf(key)}>
            {name}
            {key === "1d" && <small> best</small>}
          </button>
        ))}
        <span className="muted">{TF_WHY[tf]}</span>
      </div>
      {coin.source === "futures" ? (
        <p className="muted">
          Binance lists {coin.coin} only as a USDT perpetual, so this is its futures price and the
          desk can't trade it. To buy it: Bybit, Kraken or Coinbase.
        </p>
      ) : market && market.interval === tf && market.candles.length > 1 ? (
        <BotChart
          candles={market.candles}
          levels={levels}
          averages={averagesOf(tf)}
          volume
          height={360}
          label={`${coin.coin} ${TF_NAME[tf]} candles with volume, the 20 and 50 averages, support and resistance`}
        />
      ) : (
        <div className="skeleton" style={{ height: 360 }} />
      )}
      {market && market.candles.length > 1 && (
        <p className="acc-tf-note muted">{caption(tf, market.candles)}</p>
      )}

      {coin.insight && (
        <div className={`acc-read is-${coin.insight.status}`}>
          <b>{coin.insight.setup}</b>
          <span className="muted">{coin.insight.trend}</span>
        </div>
      )}

      {read ? (
        <div className={`acc-agent is-${read.verdict}`} aria-live="polite">
          <p className="acc-agent-head">
            <span className={`acc-verdict is-${read.verdict}`}>{VERDICT[read.verdict]}</span>
            {read.headline}
          </p>
          <ul>
            {read.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {read.verdict !== "take" && read.watch && (
            <p className="muted">
              <b>Becomes a take if:</b> {read.watch}
            </p>
          )}
          {read.plan && (
            <p className="num acc-plan">
              Entry {limit(read.plan.entry)} · stop {limit(read.plan.stop)} · target{" "}
              {limit(read.plan.target)}
            </p>
          )}
        </div>
      ) : (
        coin.tradable && (
          <p className="muted acc-ask-note">
            trading-agent reads it against your rules when you ask: one model call.
          </p>
        )
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!coin.tradable && (
        <p className="muted">
          Not one of trading-agent's coins, so it isn't analysed or traded from this account.
        </p>
      )}
      <div className="dca-nav">
        {coin.tradable && (
          <button className="btn" type="button" disabled={asking} onClick={ask}>
            {asking ? "Asking trading-agent…" : read ? "Ask again" : "Ask trading-agent"}
          </button>
        )}
        {coin.tradable && (
          <button className="btn btn-accent" type="button" onClick={onTrade}>
            New trade on {coin.coin}
          </button>
        )}
      </div>
    </dialog>
  );
}
