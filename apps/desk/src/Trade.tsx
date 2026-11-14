import { useCallback, useEffect, useState } from "react";
import { ApiError, cancelTrade, closeTrade, getTerminal, placeTrade, setLimits } from "./api";
import { amount, dateTime, percent, usd } from "./format";
import type { Settings, SmartTrade, Terminal, TradeStatus } from "./types";
import { Icon, Signed, type Status } from "./ui";

const WATCH_MS = 30_000;

const STATUS: Record<
  TradeStatus,
  { word: string; icon: Parameters<typeof Icon>[0]["name"]; tone: string }
> = {
  placing: { word: "Placing", icon: "clock", tone: "quiet" },
  waiting: { word: "Waiting for entry", icon: "clock", tone: "quiet" },
  needs_exits: { word: "Needs exits", icon: "alert", tone: "caution" },
  protected: { word: "Protected", icon: "shield", tone: "positive" },
  open: { word: "Open, no exits", icon: "alert", tone: "caution" },
  closed_tp: { word: "Closed at take-profit", icon: "check", tone: "positive" },
  closed_sl: { word: "Closed at stop-loss", icon: "x", tone: "critical" },
  closed_market: { word: "Closed at market", icon: "check", tone: "quiet" },
  cancelled: { word: "Cancelled", icon: "minus", tone: "faint" },
};

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

function floorTo(value: number, step: number): number {
  return step > 0 ? Math.floor(value / step + 1e-9) * step : value;
}

function decimals(step: string): number {
  return (step.split(".")[1] ?? "").replace(/0+$/, "").length;
}

function fixed(value: number, step: string): string {
  return Number.isFinite(value) ? value.toFixed(decimals(step)) : "";
}

function Limits({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const unset = Number(settings.perOrder) <= 0 || Number(settings.perDay) <= 0;
  const [editing, setEditing] = useState(false);
  const [perOrder, setPerOrder] = useState(unset ? "" : settings.perOrder);
  const [perDay, setPerDay] = useState(unset ? "" : settings.perDay);
  const [error, setError] = useState("");

  const save = () => {
    setError("");
    setLimits(perOrder, perDay).then(
      (saved) => {
        setEditing(false);
        onSaved(saved);
      },
      (e: unknown) => setError(message(e)),
    );
  };

  if (!unset && !editing) {
    const used = Number(settings.spentToday);
    const day = Number(settings.perDay);
    return (
      <div className="panel">
        <h3>Your limits</h3>
        <dl>
          <dt>Per order</dt>
          <dd>{usd(settings.perOrder)}</dd>
          <dt>Today</dt>
          <dd>
            {usd(settings.spentToday)} of {usd(settings.perDay)}
          </dd>
        </dl>
        <div className="meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (used / day) * 100)}%` }} />
        </div>
        <p className="foot">
          {usd(settings.leftToday)} left today. Resets at midnight Sydney time.
        </p>
        <button className="small" type="button" onClick={() => setEditing(true)}>
          Change limits
        </button>
      </div>
    );
  }
  return (
    <div className="panel">
      <h3>{unset ? "Set your limits to trade" : "Change your limits"}</h3>
      <p className="sub">Nothing can be sent until both are set. You can change them any time.</p>
      <label htmlFor="per-order">Per order</label>
      <div className="field">
        <input
          id="per-order"
          inputMode="decimal"
          value={perOrder}
          placeholder="0.00"
          onChange={(e) => setPerOrder(e.target.value)}
        />
        <span>USDT</span>
      </div>
      <label htmlFor="per-day">Per day</label>
      <div className="field">
        <input
          id="per-day"
          inputMode="decimal"
          value={perDay}
          placeholder="0.00"
          onChange={(e) => setPerDay(e.target.value)}
        />
        <span>USDT</span>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        {!unset && (
          <button className="ghost" type="button" onClick={() => setEditing(false)}>
            Back
          </button>
        )}
        <button className="primary" type="button" onClick={save}>
          Save limits
        </button>
      </div>
    </div>
  );
}

interface Ticket {
  entry: "market" | "limit";
  limitPrice: string;
  spend: string;
  takeOn: boolean;
  take: string;
  takePct: string;
  stopOn: boolean;
  stop: string;
  stopPct: string;
}

const EMPTY: Ticket = {
  entry: "market",
  limitPrice: "",
  spend: "",
  takeOn: true,
  take: "",
  takePct: "3",
  stopOn: true,
  stop: "",
  stopPct: "2",
};

function TicketForm({
  terminal,
  settings,
  onPlaced,
}: {
  terminal: Terminal;
  settings: Settings;
  onPlaced: () => void;
}) {
  const [t, setT] = useState<Ticket>(EMPTY);
  const [clientId, setClientId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const market = Number(terminal.price);
  const reference = t.entry === "limit" ? Number(t.limitPrice) : market;
  const priceAt = (pct: string, sign: 1 | -1) =>
    reference > 0 && pct !== ""
      ? fixed(
          floorTo(reference * (1 + (sign * Number(pct)) / 100), Number(terminal.tick)),
          terminal.tick,
        )
      : "";
  const pctOf = (price: string, sign: 1 | -1) =>
    reference > 0 && price !== ""
      ? (((sign * (Number(price) - reference)) / reference) * 100).toFixed(2)
      : "";
  const take = t.take || priceAt(t.takePct, 1);
  const stop = t.stop || priceAt(t.stopPct, -1);
  const qty = reference > 0 ? floorTo(Number(t.spend) / reference, Number(terminal.step)) : 0;
  const reward = t.takeOn && take ? qty * (Number(take) - reference) : null;
  const risk = t.stopOn && stop ? qty * (reference - Number(stop)) : null;
  const left = Number(settings.leftToday) - Number(t.spend || 0);
  const canTrade =
    settings.tradingOn && Number(settings.perOrder) > 0 && Number(settings.perDay) > 0;
  const ready = canTrade && Number(t.spend) > 0 && reference > 0;

  const set = (changes: Partial<Ticket>) => {
    setClientId(null);
    setDone("");
    setT((prev) => ({ ...prev, ...changes }));
  };

  const send = () => {
    if (!clientId) return;
    setSending(true);
    setError("");
    placeTrade({
      clientId,
      symbol: terminal.symbol,
      entry: t.entry,
      limitPrice: t.entry === "limit" ? t.limitPrice : undefined,
      spend: t.spend,
      takeProfit: t.takeOn ? take : undefined,
      stopLoss: t.stopOn ? stop : undefined,
    }).then(
      () => {
        setSending(false);
        setClientId(null);
        setT(EMPTY);
        setDone("Smart trade sent. It's in the list below.");
        onPlaced();
      },
      (e: unknown) => {
        setSending(false);
        setError(message(e));
      },
    );
  };

  const words = [
    `Buy about ${amount(String(qty))} ${terminal.base}`,
    t.entry === "market"
      ? `at market for ${usd(t.spend)}.`
      : `at ${usd(t.limitPrice)} or better, for ${usd(t.spend)}.`,
    t.takeOn && t.stopOn
      ? `Then sell it all at ${usd(take)} or ${usd(stop)}, whichever comes first. Both exits sit on Binance, so they hold while the desk is off.`
      : t.takeOn
        ? `Then sell it all at ${usd(take)}.`
        : t.stopOn
          ? `Then sell it all if the price falls to ${usd(stop)}.`
          : "No exits: it stays held until you close it.",
  ].join(" ");

  let label = "Review smart trade";
  if (!settings.tradingOn) label = "Trading is off";
  else if (!canTrade) label = "Set your limits first";

  return (
    <form className="panel" onSubmit={(e) => e.preventDefault()} aria-labelledby="ticket">
      <h3 id="ticket">Smart trade: buy {terminal.base}</h3>
      <div className="seg" role="group" aria-label="Entry">
        {(["market", "limit"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={t.entry === entry}
            onClick={() => set({ entry, take: "", stop: "" })}
          >
            {entry === "market" ? "Market" : "Limit"}
          </button>
        ))}
      </div>
      {t.entry === "limit" && (
        <>
          <label htmlFor="limit-price">Buy at or below</label>
          <div className="field">
            <input
              id="limit-price"
              inputMode="decimal"
              value={t.limitPrice}
              placeholder={terminal.price}
              onChange={(e) => set({ limitPrice: e.target.value, take: "", stop: "" })}
            />
            <span>USDT</span>
          </div>
        </>
      )}
      <label htmlFor="spend">Spend</label>
      <div className="field">
        <input
          id="spend"
          inputMode="decimal"
          value={t.spend}
          placeholder="0.00"
          onChange={(e) => set({ spend: e.target.value })}
        />
        <span>USDT</span>
      </div>
      <p className="foot">
        About {amount(String(qty))} {terminal.base}. Binance's smallest order here is{" "}
        {usd(terminal.minOrder)}.
      </p>

      <label className="toggle">
        <input
          type="checkbox"
          checked={t.takeOn}
          onChange={(e) => set({ takeOn: e.target.checked })}
        />{" "}
        Take profit
      </label>
      {t.takeOn && (
        <div className="exit">
          <div className="field">
            <input
              aria-label="Take-profit price"
              inputMode="decimal"
              value={take}
              onChange={(e) => set({ take: e.target.value, takePct: pctOf(e.target.value, 1) })}
            />
            <span>USDT</span>
          </div>
          <div className="field">
            <input
              aria-label="Take-profit percent"
              inputMode="decimal"
              value={t.takePct}
              onChange={(e) => set({ takePct: e.target.value, take: "" })}
            />
            <span>%</span>
          </div>
        </div>
      )}
      <label className="toggle">
        <input
          type="checkbox"
          checked={t.stopOn}
          onChange={(e) => set({ stopOn: e.target.checked })}
        />{" "}
        Stop loss
      </label>
      {t.stopOn && (
        <div className="exit">
          <div className="field">
            <input
              aria-label="Stop-loss price"
              inputMode="decimal"
              value={stop}
              onChange={(e) => set({ stop: e.target.value, stopPct: pctOf(e.target.value, -1) })}
            />
            <span>USDT</span>
          </div>
          <div className="field">
            <input
              aria-label="Stop-loss percent"
              inputMode="decimal"
              value={t.stopPct}
              onChange={(e) => set({ stopPct: e.target.value, stop: "" })}
            />
            <span>%</span>
          </div>
        </div>
      )}

      <div className="sum">
        <dl>
          <dt>If it hits take profit</dt>
          <dd className="up">{reward !== null ? usd(String(reward), true) : "–"}</dd>
          <dt>If it hits stop loss</dt>
          <dd className="down">{risk !== null ? usd(String(-risk), true) : "–"}</dd>
          <dt>Reward to risk</dt>
          <dd>{reward !== null && risk ? `${(reward / risk).toFixed(1)} to 1` : "–"}</dd>
          <dt>Left today after this</dt>
          <dd>{usd(String(Math.max(left, 0)))}</dd>
        </dl>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="inline-done" role="status">
          {done}
        </p>
      )}
      {clientId === null ? (
        <button
          className="primary wide"
          type="button"
          disabled={!ready}
          onClick={() => setClientId(crypto.randomUUID())}
        >
          {label}
        </button>
      ) : (
        <div className="confirm">
          <p>{words}</p>
          <div className="row">
            <button
              className="ghost"
              type="button"
              onClick={() => setClientId(null)}
              disabled={sending}
            >
              Back
            </button>
            <button
              className="primary"
              type="button"
              onClick={send}
              disabled={sending || !canTrade}
              aria-busy={sending}
            >
              {sending ? "Sending" : "Place smart trade"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function TradeRow({
  trade,
  onChanged,
}: {
  trade: SmartTrade;
  onChanged: (error?: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const status = STATUS[trade.status];
  const act = (run: (id: number) => Promise<SmartTrade>) =>
    run(trade.id).then(
      () => onChanged(),
      (e: unknown) => onChanged(message(e)),
    );
  const closable = ["protected", "needs_exits", "open"].includes(trade.status);
  return (
    <tr>
      <td className="quiet">{dateTime(trade.created)}</td>
      <td>{trade.pair}</td>
      <td className="n">
        {usd(trade.entryPrice)} <span className="quiet">{trade.entry}</span>
      </td>
      <td className="n quiet">{amount(trade.amount)}</td>
      <td className="n">{usd(trade.takeProfit)}</td>
      <td className="n">{usd(trade.stopLoss)}</td>
      <td>
        <span className={`status ${status.tone}`} title={trade.note ?? undefined}>
          <Icon name={status.icon} />
          {status.word}
        </span>
        {trade.note && <span className="partial">{trade.note}</span>}
      </td>
      <td className="n">
        <Signed value={trade.profit}>{usd(trade.profit, true)}</Signed>
      </td>
      <td>
        {trade.status === "waiting" && (
          <button className="small" type="button" onClick={() => void act(cancelTrade)}>
            Cancel
          </button>
        )}
        {closable &&
          (asking ? (
            <span className="row-confirm">
              Sell all at market?{" "}
              <button className="small" type="button" onClick={() => void act(closeTrade)}>
                Yes, close
              </button>{" "}
              <button className="small" type="button" onClick={() => setAsking(false)}>
                No
              </button>
            </span>
          ) : (
            <button className="small" type="button" onClick={() => setAsking(true)}>
              Close at market
            </button>
          ))}
      </td>
    </tr>
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
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [error, setError] = useState("");

  const settle = useCallback(
    (pending: Promise<Terminal>) => {
      pending.then(
        (data) => {
          setTerminal(data);
          setError("");
          onSettings(data.settings);
          onStatus(data.demo ? "demo" : "connected");
        },
        (e: unknown) => {
          setError(message(e));
          onStatus("disconnected");
        },
      );
    },
    [onSettings, onStatus],
  );

  useEffect(() => {
    settle(getTerminal(symbol));
    const timer = window.setInterval(() => settle(getTerminal(symbol)), WATCH_MS);
    return () => window.clearInterval(timer);
  }, [symbol, settle]);

  const reload = (problem?: string) => {
    if (problem) setError(problem);
    settle(getTerminal(symbol));
  };
  const live = settings ?? terminal?.settings ?? null;

  return (
    <main>
      <div className="head">
        <div>
          <h1>Trade terminal</h1>
          <p className="sub">
            {terminal?.demo
              ? "Spot only, demo mode: a pretend exchange, so nothing here is real."
              : "Spot only, live account. Every order is checked against your limits before it reaches Binance."}
          </p>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
          <button type="button" onClick={() => reload()}>
            Try again
          </button>
        </div>
      )}
      {terminal && live ? (
        <>
          <div className="trade">
            <div className="stack">
              <div className="panel">
                <label htmlFor="pair" className="first">
                  Pair
                </label>
                <select
                  id="pair"
                  value={terminal.symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                >
                  {terminal.pairs.map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.pair}
                    </option>
                  ))}
                </select>
                <div className="price">{usd(terminal.price)}</div>
                <div className="aside">
                  <Signed
                    value={terminal.change24h}
                  >{`${percent(terminal.change24h)} in 24 hours`}</Signed>
                </div>
              </div>
              <div className="panel">
                <dl>
                  <dt>Available USDT</dt>
                  <dd>{amount(terminal.quoteFree)}</dd>
                  <dt>Held {terminal.base}</dt>
                  <dd>{amount(terminal.baseFree)}</dd>
                </dl>
              </div>
              <Limits
                key={`${live.perOrder}-${live.perDay}`}
                settings={live}
                onSaved={(s) => {
                  onSettings(s);
                  reload();
                }}
              />
            </div>
            <TicketForm
              key={terminal.symbol}
              terminal={terminal}
              settings={live}
              onPlaced={() => reload()}
            />
          </div>

          <h2>Smart trades</h2>
          {terminal.trades.length === 0 ? (
            <p className="empty">No smart trades yet. Your first one will show here.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Opened</th>
                    <th>Pair</th>
                    <th className="n">Entry</th>
                    <th className="n">Amount</th>
                    <th className="n">Take profit</th>
                    <th className="n">Stop loss</th>
                    <th>Status</th>
                    <th className="n">Profit or loss</th>
                    <th>
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {terminal.trades.map((trade) => (
                    <TradeRow key={trade.id} trade={trade} onChanged={reload} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="foot">
            A limit buy that fills while the desk is off gets its exits when the desk next runs.
            Until then it shows as Needs exits. Open trades are checked every 30 seconds.
          </p>
        </>
      ) : (
        !error && (
          <div aria-hidden="true">
            <div className="skeleton block" />
          </div>
        )
      )}
    </main>
  );
}
