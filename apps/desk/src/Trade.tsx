import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useChartHeight, useColumns } from "./columns";
import { ResetIcon } from "./icons";
import {
  ApiError,
  createWatchlist,
  deleteWatchlist,
  getMarket,
  getTerminal,
  getWatchlist,
  runSignal,
  unwatchCoin,
  watchCoin,
} from "./api";
import KeyLevels from "./KeyLevels";
import TradingViewChart from "./TradingViewChart";
import { percent, price, trend, usd, usdShort } from "./format";
import AiPanel from "./AiPanel";
import SmartTradePanel from "./SmartTrade";
import type { Interval, Market, Settings, Terminal, Verdict, Watchlist } from "./types";
import type { Status } from "./ui";
import CoinIcon from "./CoinIcon";

const WATCH_MS = 30_000;
// The market stats beside the chart come from 4h candles; the chart itself is TradingView's.
const INTERVAL: Interval = "4h";

const TAG: Record<Verdict, string> = { "Buy now": "buy", Wait: "wait", Avoid: "sell" };

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

function WatchlistPanel({
  list,
  selected,
  analysing,
  onSelect,
  onChange,
  onAnalyseAll,
}: {
  list: Watchlist | null;
  selected: string;
  analysing: { done: number; total: number } | null;
  onSelect: (coin: string) => void;
  onChange: (next: Watchlist, added?: string) => void;
  onAnalyseAll: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [menu]);
  const listId = list?.list.id ?? 0;

  const settle = (pending: Promise<Watchlist>, after?: (next: Watchlist) => void) => {
    setError("");
    pending.then(
      (next) => {
        if (after) after(next);
        else onChange(next);
      },
      (err: unknown) => setError(message(err)),
    );
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const coin = typed.trim().toUpperCase();
    if (!coin || !listId) return;
    settle(watchCoin(coin, listId), (next) => {
      setTyped("");
      onChange(next, coin.replace(/(USDT|USDC|FDUSD)$/, ""));
    });
  };
  const remove = (coin: string) => settle(unwatchCoin(coin, listId));
  const create = (e: FormEvent) => {
    e.preventDefault();
    settle(createWatchlist(newName), (next) => {
      setNaming(false);
      setNewName("");
      onChange(next);
    });
  };
  const drop = () =>
    settle(deleteWatchlist(listId), (next) => {
      setDropping(false);
      onChange(next);
    });

  return (
    <section aria-label="Watchlist">
      <div className="wl-head" ref={menuBox}>
        <button
          type="button"
          className="wl-title"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          {list?.list.name ?? "Watchlist"} <span aria-hidden="true">▾</span>
        </button>
        <button
          type="button"
          className="btn btn-small wl-analyse"
          disabled={!list?.coins.length || analysing !== null}
          title="A fresh AI analysis of every coin in this list"
          onClick={onAnalyseAll}
        >
          {analysing ? `Analysing ${analysing.done + 1} of ${analysing.total}` : "Analyse all"}
        </button>
        {menu && (
          <div className="create-list wl-menu" role="menu" aria-label="Watchlists">
            {list?.lists.map((l) => (
              <button
                key={l.id}
                type="button"
                role="menuitem"
                className={l.id === listId ? "on" : ""}
                onClick={() => {
                  setMenu(false);
                  setEditing(false);
                  settle(getWatchlist(l.id));
                }}
              >
                {l.name}
                <span className="muted">{l.count}</span>
              </button>
            ))}
            <hr />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setEditing(true);
              }}
            >
              Edit {list?.list.name ?? "list"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setNaming(true);
              }}
            >
              New list
            </button>
            {list && list.lists.length > 1 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setDropping(true);
                }}
              >
                Delete {list.list.name}
              </button>
            )}
          </div>
        )}
      </div>
      {naming && (
        <form className="wl-add" onSubmit={create}>
          <label htmlFor="wl-name" className="visually-hidden">
            New watchlist name
          </label>
          <input
            id="wl-name"
            placeholder="Name, e.g. Memes"
            autoComplete="off"
            maxLength={30}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn" type="submit">
            Create
          </button>
          <button className="link" type="button" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </form>
      )}
      {dropping && list && (
        <p className="wl-note">
          Delete {list.list.name}?{" "}
          <button className="link" type="button" onClick={drop}>
            Delete
          </button>{" "}
          <button className="link" type="button" onClick={() => setDropping(false)}>
            Keep
          </button>
        </p>
      )}
      {editing && (
        <>
          <form className="wl-add" onSubmit={add}>
            <label htmlFor="wl-in" className="visually-hidden">
              Add coin
            </label>
            <input
              id="wl-in"
              placeholder="Add a coin, e.g. AVAX"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button className="btn" type="submit">
              Add
            </button>
          </form>
          <div className="wl-note muted wl-meta">
            <span>{list ? `${list.coins.length} of ${list.max} coins` : ""}</span>
            <button className="link" type="button" onClick={() => setEditing(false)}>
              Done
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="wl-note down" role="alert">
          {error}
        </p>
      )}
      {list && list.coins.length === 0 && (
        <p className="wl-note muted">Add a coin to get its chart and an AI signal.</p>
      )}
      <ul className="wl">
        {list?.coins.map((c) => (
          <li key={c.coin} className={c.coin === selected ? "sel" : ""}>
            <button
              className="wl-main"
              type="button"
              aria-current={c.coin === selected ? "true" : undefined}
              onClick={() => onSelect(c.coin)}
            >
              <span className="coin">
                <CoinIcon coin={c.coin} />
              </span>
              <span className="n">
                <span style={{ display: "block", fontWeight: 500 }}>{c.pair}</span>
                <span className="num muted" style={{ fontSize: 12 }}>
                  {price(c.price)}{" "}
                  <span className={trend(c.change24h)}>{percent(c.change24h)}</span>
                </span>
              </span>
              {c.signal ? (
                <span className={`tag ${TAG[c.signal.verdict]}`}>{c.signal.verdict}</span>
              ) : (
                <span className="tag none">No signal</span>
              )}
            </button>
            {editing && (
              <button
                className="wl-rm"
                type="button"
                aria-label={`Remove ${c.coin}`}
                onClick={() => remove(c.coin)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {list && (
        <p className="budget muted">
          AI spend this month: {usd(list.aiBudget.spent)} of {usd(list.aiBudget.cap)}
        </p>
      )}
    </section>
  );
}

export default function Trade({
  settings,
  onSettings,
  onStatus,
}: {
  settings: Settings | null;
  onSettings: (s: Settings) => void;
  onStatus: (status: Status) => void;
}) {
  const [list, setList] = useState<Watchlist | null>(null);
  const [selected, setSelected] = useState("");
  const interval = INTERVAL;
  const [resets, setResets] = useState(0); // the Reset chart button: reloads or refits the chart
  const [loaded, setMarket] = useState<Market | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [running, setRunning] = useState(false);
  const [signalError, setSignalError] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // The AI panel's Prefill: a side and price for the smart trade form; nothing is sent.
  const [prefill, setPrefill] = useState<{ side: "buy" | "sell"; price: string; n: number } | null>(
    null,
  );

  const shownList = useRef(0); // the watchlist on screen, so a reload keeps it
  const loadList = useCallback(
    () =>
      getWatchlist(shownList.current || undefined).then(
        (next) => {
          shownList.current = next.list.id;
          setList(next);
          setSelected((s) => s || next.coins[0]?.coin || "BTC");
        },
        (e: unknown) => {
          setError(message(e));
          onStatus("disconnected");
        },
      ),
    [onStatus],
  );

  const loadTerminal = useCallback(
    (coin: string) =>
      getTerminal(coin).then(
        (data) => {
          setTerminal(data);
          onSettings(data.settings);
          onStatus(data.demo ? "demo" : "connected");
        },
        (e: unknown) => {
          setError(message(e));
          onStatus("disconnected");
        },
      ),
    [onSettings, onStatus],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    getMarket(selected, interval).then(setMarket, (e: unknown) => setError(message(e)));
  }, [selected, interval]);

  useEffect(() => {
    if (!selected) return;
    void loadTerminal(selected);
    const timer = window.setInterval(() => void loadTerminal(selected), WATCH_MS);
    return () => window.clearInterval(timer);
  }, [selected, loadTerminal]);

  // Analyse all: a fresh signal for each coin in the list, one at a time.
  const [analysing, setAnalysing] = useState<{ done: number; total: number } | null>(null);
  const analyseAll = async () => {
    const coins = list?.coins.map((c) => c.coin) ?? [];
    setSignalError("");
    for (const [n, coin] of coins.entries()) {
      setAnalysing({ done: n, total: coins.length });
      try {
        await runSignal(coin, true);
      } catch (e: unknown) {
        setSignalError(message(e));
        break;
      }
      void loadList();
    }
    setAnalysing(null);
  };

  const run = (coin: string, force: boolean) => {
    setRunning(true);
    setSignalError("");
    runSignal(coin, force).then(
      () => {
        setRunning(false);
        void loadList();
      },
      (e: unknown) => {
        setRunning(false);
        setSignalError(message(e));
      },
    );
  };

  const changed = (next: Watchlist, added?: string) => {
    shownList.current = next.list.id;
    setList(next);
    if (added) {
      setSelected(added);
      run(added, false); // a new coin gets its first signal straight away
    } else if (!next.coins.some((c) => c.coin === selected)) {
      setSelected(next.coins[0]?.coin ?? "BTC");
    }
  };

  const after = (problem?: string, note?: string) => {
    setError(problem ?? "");
    setDone(note ?? "");
    void loadTerminal(selected);
  };

  const columns = useColumns();
  const chartHeight = useChartHeight();
  const [chartShown, setChartShown] = useState(() => {
    try {
      return window.localStorage.getItem("desk.trade.chart") !== "hidden";
    } catch {
      return true;
    }
  });
  const showChart = (shown: boolean) => {
    setChartShown(shown);
    try {
      window.localStorage.setItem("desk.trade.chart", shown ? "shown" : "hidden");
    } catch {
      // private window: the choice lasts this visit only
    }
  };
  const signal = list?.coins.find((c) => c.coin === selected)?.signal ?? null;
  // The chart shows only once it's the selected coin's.
  const market = loaded?.coin === selected && loaded.interval === interval ? loaded : null;
  const live = settings ?? terminal?.settings ?? null;

  return (
    <main className="trade" style={columns.style}>
      {columns.grip}
      <WatchlistPanel
        list={list}
        selected={selected}
        analysing={analysing}
        onAnalyseAll={() => void analyseAll()}
        onSelect={(coin) => {
          setSelected(coin);
          setSignalError("");
          setDone("");
        }}
        onChange={changed}
      />

      <section aria-label="Chart and analysis">
        {error && (
          <div className="alert" role="alert" style={{ margin: 14 }}>
            <span>{error}</span>
          </div>
        )}
        {market ? (
          <>
            <div className="mkt">
              <div className="pair">{market.pair}</div>
              <div>
                <div className="s">Price</div>
                <div className="num">{price(market.price)}</div>
              </div>
              <div>
                <div className="s">24h change</div>
                <div className={`num ${trend(market.change24h)}`}>{percent(market.change24h)}</div>
              </div>
              <div>
                <div className="s">24h high / low</div>
                <div className="num">
                  {price(market.high24h)} / {price(market.low24h)}
                </div>
              </div>
              <div>
                <div className="s">24h volume</div>
                <div className="num">{usdShort(market.volume24h)}</div>
              </div>
              {terminal?.demo && <span className="tag wait">Demo exchange</span>}
            </div>
            <div className="chart-bar">
              <span className="spacer" />
              <button
                type="button"
                className="chart-reset"
                aria-pressed={!chartShown}
                onClick={() => showChart(!chartShown)}
              >
                {chartShown ? "Hide chart" : "Show chart"}
              </button>
              {chartShown && (
                <button
                  type="button"
                  className="chart-reset"
                  title="Right-click reset isn't available in the embedded chart"
                  onClick={() => setResets((n) => n + 1)}
                >
                  <ResetIcon />
                  Reset chart
                </button>
              )}
            </div>
            <KeyLevels market={market} />
            {chartShown && (
              <div className="chart-box" style={chartHeight.style}>
                <TradingViewChart
                  key={`${market.symbol}-${resets}`}
                  symbol={market.symbol}
                  pair={market.pair}
                />
                {chartHeight.grip}
              </div>
            )}
          </>
        ) : (
          !error && (
            <div aria-hidden="true" className="skeleton" style={{ height: 420, margin: 14 }} />
          )
        )}
        {selected && (
          <AiPanel
            coin={selected}
            signal={signal}
            running={running}
            error={signalError}
            onRun={() => run(selected, true)}
            onPrefill={(side, at) => setPrefill((p) => ({ side, price: at, n: (p?.n ?? 0) + 1 }))}
          />
        )}
      </section>

      <section aria-label="Order form">
        {done && (
          <div className="alert done" role="status" style={{ margin: "14px 14px 0" }}>
            <span>{done}</span>
          </div>
        )}
        {terminal && live ? (
          <>
            <SmartTradePanel
              prefill={prefill}
              terminal={terminal}
              settings={live}
              signal={signal}
              market={market}
              onPlaced={(note) => after(undefined, note)}
              onSettings={(next) => {
                onSettings(next);
                after();
              }}
              onDone={(problem) => after(problem)}
            />
          </>
        ) : (
          <div aria-hidden="true" className="skeleton" style={{ height: 300, margin: 14 }} />
        )}
      </section>
    </main>
  );
}
