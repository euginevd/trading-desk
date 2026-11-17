// The Trading account's watchlist, at the foot of the page and folded away when not wanted: a
// card per coin (price, day, 30 days as a line, and the one thing to do about it), Edit to add
// or remove coins, and a panel per coin with its daily chart, the desk's read and, when asked,
// trading-agent's (one model call per ask), then New trade on it.
import { useCallback, useEffect, useRef, useState } from "react";
import { analysePotCoin, getAccountCoins, getMarket, unwatchCoin, watchCoin } from "./api";
import { BotChart, type Level } from "./BotKit";
import CoinIcon from "./CoinIcon";
import { dollars, limit } from "./dcaFormat";
import type { AccountCoin, Market, PotAnalysis } from "./types";

const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const OPEN_KEY = "desk.account.watchlist";
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const toneOf = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "");

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

// What to do about a coin, in a word: the card's chip.
const ACTION: Record<"watch" | "wait" | "none", string> = {
  watch: "Analyse",
  wait: "Wait",
  none: "No setup",
};

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

  return (
    <section className="dcb-section acc-watch" aria-labelledby="acc-watch-title">
      <div className="dcb-section-head">
        <button
          type="button"
          className="acc-fold"
          aria-expanded={open}
          aria-controls="acc-watch-body"
          onClick={toggle}
        >
          <h2 id="acc-watch-title">Watchlist</h2>
          <span className="muted">
            {coins === null
              ? "Reading…"
              : `${coins.length} ${coins.length === 1 ? "coin" : "coins"}${ready ? `, ${ready} worth an Analyse` : ", no setups now"}`}
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
            <div className="acc-coins">
              {coins.map((c) => {
                const day = Number(c.change24hPct);
                const status = c.insight?.status ?? "none";
                return (
                  <button
                    key={c.coin}
                    type="button"
                    className={`acc-coin is-${status}`}
                    onClick={() => setViewing(c.coin)}
                    aria-label={`${c.coin}: ${c.insight?.setup ?? "no read yet"} Open its chart`}
                  >
                    <span className="acc-coin-head">
                      <span className="dcb-coin">
                        <CoinIcon coin={c.coin} />
                        {c.coin}
                      </span>
                      <span className="num">{limit(c.price)}</span>
                      <small className={`num ${toneOf(day)}`}>{signed(day)}</small>
                    </span>
                    <Spark closes={c.spark} />
                    <span className="acc-coin-foot">
                      <span className={`acc-act is-${status}`}>
                        {c.inTrade ? "In a trade" : c.watching ? "Proposed" : ACTION[status]}
                      </span>
                      <small className="muted num">
                        {Number(c.value) > 0 ? `${dollars(c.value)} held` : "not held"}
                      </small>
                    </span>
                  </button>
                );
              })}
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
  const [read, setRead] = useState<PotAnalysis | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    getMarket(`${coin.coin}${quote}`, "1d").then(setMarket, () => setMarket(null));
  }, [coin.coin, quote]);

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
    ...(ind?.sma20 ? [{ price: Number(ind.sma20), title: "20-day", tone: "muted" as const }] : []),
    ...(ind?.sma50 ? [{ price: Number(ind.sma50), title: "50-day", tone: "muted" as const }] : []),
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
      {market && market.candles.length > 1 ? (
        <BotChart
          candles={market.candles}
          levels={levels}
          height={340}
          label={`${coin.coin} daily candles with support, resistance and the 20- and 50-day averages`}
        />
      ) : (
        <div className="skeleton" style={{ height: 340 }} />
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
