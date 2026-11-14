import { useCallback, useEffect, useState } from "react";
import { ApiError, getPortfolio } from "./api";
import { amount, aud, dateTime, fetchedAt, percent, shortDate, trend, usd } from "./format";
import type { Holding, Portfolio } from "./types";

type State =
  | { kind: "loading"; last: Portfolio | null }
  | { kind: "ready"; data: Portfolio }
  | { kind: "error"; message: string; last: Portfolio | null };

function Icon({ name }: { name: "check" | "refresh" | "alert" }) {
  const paths = {
    check: <path d="M20 6 9 17l-5-5" />,
    refresh: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
    alert: (
      <>
        <path d="M12 9v4M12 17h.01" />
        <circle cx="12" cy="12" r="10" />
      </>
    ),
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function Signed({ value, children }: { value: string | null; children: string }) {
  return <span className={trend(value)}>{children}</span>;
}

function HoldingRow({ h }: { h: Holding }) {
  const partial = h.covered !== null && Number(h.covered) < Number(h.amount);
  return (
    <tr>
      <td className="asset">{h.asset}</td>
      <td className="n quiet">{amount(h.amount)}</td>
      <td className="n quiet">{usd(h.price)}</td>
      <td className="n">{usd(h.value)}</td>
      <td>
        <span className="share" aria-hidden="true">
          <i style={{ width: `${Number(h.share ?? 0)}%` }} />
        </span>
        {percent(h.share, false)}
      </td>
      <td className="n">
        <Signed value={h.change24h}>{percent(h.change24h)}</Signed>
      </td>
      <td className="n quiet">
        {usd(h.averageCost)}
        {partial && (
          <span className="partial">
            covers {amount(h.covered)} of {amount(h.amount)}
          </span>
        )}
      </td>
      <td className="n">
        <Signed value={h.profit}>{usd(h.profit, true)}</Signed>
        {h.profitPercent !== null && <span className="quiet"> ({percent(h.profitPercent)})</span>}
        {partial && <span className="partial">on {amount(h.covered)} only</span>}
      </td>
    </tr>
  );
}

function Tables({ data }: { data: Portfolio }) {
  return (
    <>
      <h2>Holdings</h2>
      {data.holdings.length === 0 ? (
        <p className="empty">No spot balances yet. Deposit or buy on Binance, then refresh.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="n">Amount</th>
                <th className="n">Price</th>
                <th className="n">Value</th>
                <th>Share</th>
                <th className="n">24 hours</th>
                <th className="n">Average cost</th>
                <th className="n">Profit or loss</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <HoldingRow key={h.asset} h={h} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="foot">
        Average cost comes from trades against USDT, USDC and FDUSD. Coins deposited or bought
        through other pairs show what the trades cover.
      </p>

      <h2>Open orders</h2>
      {data.openOrders.length === 0 ? (
        <p className="empty">No open orders.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Placed</th>
                <th>Pair</th>
                <th>Side</th>
                <th>Type</th>
                <th className="n">Price</th>
                <th className="n">Amount</th>
                <th className="n">Filled</th>
              </tr>
            </thead>
            <tbody>
              {data.openOrders.map((o) => (
                <tr key={`${o.time}-${o.pair}-${o.price}`}>
                  <td className="quiet">{dateTime(o.time)}</td>
                  <td>{o.pair}</td>
                  <td className={o.side === "Buy" ? "up" : "down"}>{o.side}</td>
                  <td className="quiet">{o.type}</td>
                  <td className="n">{usd(o.price)}</td>
                  <td className="n quiet">{amount(o.amount)}</td>
                  <td className="n quiet">{amount(o.filled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Recent trades</h2>
      {data.recentTrades.length === 0 ? (
        <p className="empty">No trades against USDT, USDC or FDUSD yet.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Pair</th>
                <th>Side</th>
                <th className="n">Price</th>
                <th className="n">Amount</th>
                <th className="n">Total</th>
                <th className="n">Fee</th>
              </tr>
            </thead>
            <tbody>
              {data.recentTrades.map((t) => (
                <tr key={`${t.time}-${t.pair}-${t.amount}`}>
                  <td className="quiet">{dateTime(t.time)}</td>
                  <td>{t.pair}</td>
                  <td className={t.side === "Buy" ? "up" : "down"}>{t.side}</td>
                  <td className="n">{usd(t.price)}</td>
                  <td className="n quiet">{amount(t.amount)}</td>
                  <td className="n">{usd(t.total)}</td>
                  <td className="n quiet">{t.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Tiles({ data }: { data: Portfolio }) {
  const t = data.total;
  return (
    <div className="tiles">
      <div className="tile big">
        <div className="label">Total value</div>
        <div className="figure">{usd(t.value)}</div>
        <div className="aside">
          {t.aud !== null
            ? `${aud(t.aud)} at ${Number(t.audRate).toFixed(4)}, ECB rate for ${t.audDate ? shortDate(t.audDate) : "today"}`
            : "Australian dollar rate unavailable right now."}
        </div>
      </div>
      <div className="tile">
        <div className="label">24 hours</div>
        <div className="figure">
          <Signed value={t.change24h}>{usd(t.change24h, true)}</Signed>
        </div>
        <div className="aside">
          <Signed value={t.change24hPercent}>{percent(t.change24hPercent)}</Signed>
        </div>
      </div>
      <div className="tile">
        <div className="label">Unrealised profit or loss</div>
        <div className="figure">
          <Signed value={t.profit}>{usd(t.profit, true)}</Signed>
        </div>
        <div className="aside">
          <Signed value={t.profitPercent}>{percent(t.profitPercent)}</Signed> on {usd(t.cost)} cost
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="tiles">
        {[0, 1, 2].map((i) => (
          <div key={i} className="tile skeleton" />
        ))}
      </div>
      <div className="skeleton block" />
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading", last: null });

  // Results arrive in callbacks, so the first fetch can start from an effect.
  const settle = useCallback((pending: Promise<Portfolio>) => {
    pending.then(
      (data) => setState({ kind: "ready", data }),
      (error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Something went wrong.";
        setState((s) => ({ kind: "error", message, last: s.kind === "loading" ? s.last : null }));
      },
    );
  }, []);

  useEffect(() => {
    settle(getPortfolio());
  }, [settle]);

  const load = () => {
    setState((s) => ({ kind: "loading", last: s.kind === "ready" ? s.data : s.last }));
    settle(getPortfolio());
  };

  const data = state.kind === "ready" ? state.data : state.last;
  const connected = state.kind === "ready";

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <span className="name">Trading desk</span>
          <span className={`status ${connected ? "positive" : "critical"}`}>
            <Icon name={connected ? "check" : "alert"} />
            {connected
              ? data?.demo
                ? "Demo data"
                : "Binance connected"
              : state.kind === "loading"
                ? "Fetching"
                : "Disconnected"}
          </span>
        </div>
      </header>
      <main>
        {data?.demo && (
          <p className="demo" role="note">
            Demo mode: made-up figures, not your account.
          </p>
        )}
        <div className="head">
          <div>
            <h1>Portfolio</h1>
            <p className="sub">
              Binance spot wallet.{data ? ` Fetched ${fetchedAt(data.fetchedAt)}.` : ""}
            </p>
          </div>
          <button
            className="refresh"
            type="button"
            onClick={load}
            disabled={state.kind === "loading"}
            aria-busy={state.kind === "loading"}
          >
            <Icon name="refresh" />
            {state.kind === "loading" ? "Fetching" : "Refresh"}
          </button>
        </div>
        {state.kind === "error" && (
          <div className="error" role="alert">
            <Icon name="alert" />
            <span>{state.message}</span>
            <button type="button" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {data ? (
          <>
            <Tiles data={data} />
            <Tables data={data} />
          </>
        ) : (
          state.kind === "loading" && <Skeleton />
        )}
      </main>
    </>
  );
}
