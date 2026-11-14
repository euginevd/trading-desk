import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelOrder,
  closeBot,
  createBot,
  getBot,
  getSmart,
  placeOrder,
  setLimits,
  suggestBot,
  switchBot,
} from "./api";
import { BotChart, type Level } from "./BotKit";
import CoinIcon from "./CoinIcon";
import { DealCard, message, quoteAmount } from "./DcaBots";
import { amount as coinAmount, dateTime, price } from "./format";
import type {
  DcaBot,
  DcaBots as Trades,
  DcaConfig,
  DcaDetail,
  Market,
  Settings,
  Signal,
  Terminal,
} from "./types";

// Smart trade: a one-off DCA deal (decision 41). New trade walks four steps, each prefilled
// from the market with its reason: the entry price, DCA orders under it, take profit and stop
// loss. The chart beside it shows every level; the trades sit below.

const STEPS = ["Entry", "DCA orders", "Take profit", "Stop loss"] as const;
const two = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function places(step: string): number {
  return (step.split(".")[1] ?? "").replace(/0+$/, "").length;
}

function floor(value: number, step: string): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const factor = 10 ** places(step);
  return (Math.floor(value * factor + 1e-9) / factor).toFixed(places(step));
}

interface Rung {
  price: number;
  qty: number;
  value: number;
}

// The base order at the entry price, then each DCA order under it, as the api works them out.
function plan(form: Form, tick: string, step: string): Rung[] {
  const entry = Number(form.entry);
  if (!(entry > 0)) return [];
  const count = form.dcaOn ? Math.max(0, Math.floor(Number(form.count))) : 0;
  const rows: Rung[] = [];
  let drop = 0;
  for (let k = 0; k <= count; k++) {
    if (k > 0) drop += Number(form.deviation) * Number(form.devMult) ** (k - 1);
    const at = Number(floor(entry * (1 - drop / 100), tick));
    const size = k === 0 ? Number(form.base) : Number(form.dca) * Number(form.sizeMult) ** (k - 1);
    const qty = Number(floor(size / at, step));
    rows.push({ price: at, qty, value: at * qty });
  }
  return rows;
}

interface Form {
  entry: string;
  base: string;
  dcaOn: boolean;
  count: string;
  deviation: string;
  dca: string;
  sizeMult: string;
  devMult: string;
  tpOn: boolean;
  tp: string;
  slOn: boolean;
  sl: string;
  config: DcaConfig | null;
}

export default function SmartTradePanel({
  prefill = null,
  terminal,
  settings,
  signal,
  market,
  onPlaced,
  onSettings,
  onDone,
}: {
  terminal: Terminal;
  settings: Settings;
  signal: Signal | null;
  market: Market | null;
  onPlaced: (note: string) => void;
  onSettings: (s: Settings) => void;
  onDone: (problem?: string) => void;
  prefill?: { side: "buy" | "sell"; price: string; n: number } | null;
}) {
  const [creating, setCreating] = useState<"buy" | "sell" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(0);
  if (prefill && prefill.n !== opened) {
    // The AI panel's Prefill opens the form at its price; the owner still confirms.
    setOpened(prefill.n);
    setCreating(prefill.side);
  }
  useEffect(() => {
    if (prefill) box.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [prefill]);
  const [trades, setTrades] = useState<Trades | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => {
    getSmart().then(setTrades, () => setTrades(null));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load, version]);

  return (
    <div className="st" ref={box}>
      <div className="st-head">
        <h2 className="wizard-title">
          <CoinIcon coin={terminal.base} />
          Smart trade · {terminal.pair}
        </h2>
        {creating === null && (
          <div className="row-actions" style={{ width: "auto" }}>
            <button className="btn btn-accent" type="button" onClick={() => setCreating("buy")}>
              New trade
            </button>
            <button className="btn" type="button" onClick={() => setCreating("sell")}>
              Sell
            </button>
          </div>
        )}
      </div>
      {creating === "buy" && (
        <NewTrade
          key={`${terminal.symbol}-${opened}`}
          start={prefill?.side === "buy" ? prefill.price : undefined}
          terminal={terminal}
          settings={settings}
          signal={signal}
          market={market}
          onSettings={onSettings}
          onCancel={() => setCreating(null)}
          onPlaced={(note) => {
            setCreating(null);
            setVersion((v) => v + 1);
            onPlaced(note);
          }}
        />
      )}
      {creating === "sell" && (
        <SellForm
          key={`sell-${opened}`}
          start={prefill?.side === "sell" ? prefill.price : undefined}
          terminal={terminal}
          settings={settings}
          market={market}
          signal={signal}
          onCancel={() => setCreating(null)}
          onPlaced={(note) => {
            setCreating(null);
            onPlaced(note);
          }}
        />
      )}
      <TradesTable
        terminal={terminal}
        trades={trades}
        onChanged={(problem) => {
          setVersion((v) => v + 1);
          onDone(problem);
        }}
      />
    </div>
  );
}

function NewTrade({
  start,
  terminal,
  settings,
  signal,
  market,
  onSettings,
  onCancel,
  onPlaced,
}: {
  terminal: Terminal;
  settings: Settings;
  signal: Signal | null;
  market: Market | null;
  onSettings: (s: Settings) => void;
  onCancel: () => void;
  onPlaced: (note: string) => void;
  start?: string;
}) {
  const q = terminal.quote;
  const now = Number(terminal.price);
  const support = Number(market?.indicators.support ?? signal?.support ?? 0);
  const resistance = Number(market?.indicators.resistance ?? signal?.resistance ?? 0);
  const buyLevel = Number(signal?.buyLevel ?? 0);
  const [entryStart] = useState(() => {
    if (start && Number(start) > 0) {
      return { price: Number(start), why: "From the AI plan's buy zone" };
    }
    if (buyLevel > 0 && buyLevel <= now * 1.01) {
      return { price: buyLevel, why: "The AI signal's suggested buy level" };
    }
    if (support > 0 && support < now && support > now * 0.97) {
      return { price: support, why: "The nearest floor: support from recent candles" };
    }
    return { price: now, why: "Today's price" };
  });
  const [form, setForm] = useState<Form>(() => ({
    entry: floor(entryStart.price, terminal.tick),
    base: "25",
    dcaOn: true,
    count: "3",
    deviation: "2",
    dca: "20",
    sizeMult: "1",
    devMult: "1",
    tpOn: true,
    tp: "2",
    slOn: true,
    sl: "",
    config: null,
  }));
  const [why, setWhy] = useState<Record<string, string>>({ entry: entryStart.why });
  const [spendIn, setSpendIn] = useState<"quote" | "coin">("quote");
  const [coinsTyped, setCoins] = useState("");
  const quick = useRef<HTMLDialogElement>(null);
  const [quickId] = useState(() => crypto.randomUUID());
  const quickQty = floor(Number(form.base) / Number(form.entry), terminal.step);
  const placeNow = () => {
    setSending(true);
    placeOrder({
      clientId: quickId,
      symbol: terminal.symbol,
      side: "buy",
      price: form.entry,
      amount: quickQty,
    }).then(
      (d) => {
        quick.current?.close?.();
        setSending(false);
        onPlaced(d.message);
      },
      (e: unknown) => {
        quick.current?.close?.();
        setSending(false);
        setError(message(e));
      },
    );
  };
  const [presetting, setPresetting] = useState(true);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  // DCA orders and take profit from what did best on the coin's last 30 days.
  useEffect(() => {
    let live = true;
    suggestBot(terminal.symbol).then(
      (found) => {
        if (!live) return;
        const c = found.config;
        setForm((f) => {
          const next = {
            ...f,
            base: c.baseOrder,
            count: String(c.maxDcaOrders),
            deviation: c.deviation,
            dca: c.dcaOrder,
            sizeMult: c.sizeMultiplier,
            devMult: c.deviationMultiplier,
            tp: c.takeProfit,
            config: c,
          };
          const rows = plan(next, terminal.tick, terminal.step);
          const last = rows[rows.length - 1]?.price ?? 0;
          return { ...next, sl: floor(last * 0.97, terminal.tick) };
        });
        setWhy((w) => ({
          ...w,
          base: found.reasons.baseOrder ?? "",
          count: found.reasons.maxDcaOrders ?? "",
          deviation: found.reasons.deviation ?? "",
          dca: found.reasons.dcaOrder ?? "",
          sizeMult: found.reasons.sizeMultiplier ?? "",
          tp: found.reasons.takeProfit ?? "",
          sl: "3% under the last DCA order: exits if the dip keeps going",
        }));
        setPresetting(false);
      },
      (e: unknown) => {
        if (!live) return;
        setError(message(e));
        setPresetting(false);
      },
    );
    return () => {
      live = false;
    };
  }, [terminal.symbol, terminal.tick, terminal.step]);

  const set = (key: keyof Form, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setWhy((w) => ({ ...w, [key]: "" }));
  };

  const rows = plan(form, terminal.tick, terminal.step);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const coins = rows.reduce((s, r) => s + r.qty, 0);
  const average = coins > 0 ? total / coins : 0;
  const first = rows[0];
  const tpFirst = first && form.tpOn ? first.price * (1 + Number(form.tp) / 100) : 0;
  const tpAll = form.tpOn ? average * (1 + Number(form.tp) / 100) : 0;
  const sl = form.slOn ? Number(form.sl) : 0;
  const reward = tpAll > 0 ? (tpAll - average) * coins : 0;
  const risk = sl > 0 ? (average - sl) * coins : 0;

  const levels: Level[] = [
    ...rows.map<Level>((r, n) => ({
      price: r.price,
      title: n ? `DCA ${n}` : "Entry",
      tone: n ? "buy" : "base",
    })),
    ...(tpFirst > 0 ? [{ price: tpFirst, title: "Take profit", tone: "tp" as const }] : []),
    ...(sl > 0 ? [{ price: sl, title: "Stop loss", tone: "sl" as const }] : []),
  ].filter((l) => l.price > 0);

  const request = () => {
    const c = form.config;
    return {
      symbol: terminal.symbol,
      timeframe: c?.timeframe ?? "1h",
      bbLength: c?.bbLength ?? 20,
      bbDeviation: c?.bbDeviation ?? "2",
      baseOrder: form.base,
      dcaOrder: form.dcaOn ? form.dca : form.base,
      deviation: form.deviation,
      maxDcaOrders: form.dcaOn ? Number(form.count) : 0,
      sizeMultiplier: form.sizeMult,
      deviationMultiplier: form.devMult,
      takeProfit: form.tp,
      maxDeals: 1,
      entryPrice: form.entry,
      takeProfitOn: form.tpOn,
      stopLoss: form.slOn ? form.sl : "",
    };
  };

  const place = async () => {
    setSending(true);
    try {
      const made = await createBot(request());
      const mine = made.bots[made.bots.length - 1];
      if (!mine) throw new Error();
      await switchBot(mine.id, true);
      dialog.current?.close?.();
      onPlaced(`${mine.ref} placed: ${rows.length} limit buys on ${terminal.pair}.`);
    } catch (e: unknown) {
      dialog.current?.close?.();
      setError(message(e));
    }
    setSending(false);
  };

  const field = (key: keyof Form, label: string, unit: string) => (
    <div className="field">
      <label htmlFor={`st-${key}`}>{label}</label>
      <div className="in">
        <input
          id={`st-${key}`}
          className="num"
          inputMode="decimal"
          value={String(form[key])}
          onChange={(e) => set(key, e.target.value)}
        />
        <span className="muted">{unit}</span>
      </div>
      {why[key] && <div className="dca-reason">{why[key]}</div>}
    </div>
  );
  const toggle = (key: "dcaOn" | "tpOn" | "slOn", label: string) => (
    <label className="st-toggle">
      <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  const off = !settings.tradingOn;
  const unset = Number(settings.perOrder) <= 0;
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "");

  return (
    <div className="dca-layout st-layout">
      <section className="card dca-wizard" aria-label="New trade">
        <ol className="dca-steps">
          {STEPS.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                className={i === step ? "on" : i < step ? "done" : ""}
                aria-current={i === step ? "step" : undefined}
                onClick={() => setStep(i)}
              >
                {i + 1} {name}
              </button>
            </li>
          ))}
        </ol>
        {presetting && (
          <p className="dca-cond muted" role="status">
            Building a preset for {terminal.base} from its last 30 days…
          </p>
        )}

        {step === 0 && (
          <>
            <div className="dca-two">
              {field("entry", "Entry price", q)}
              <div className="field">
                <label htmlFor="st-spend">
                  {spendIn === "coin" ? `${terminal.base} to buy` : "Spend at entry"}
                </label>
                <div className="in">
                  <input
                    id="st-spend"
                    className="num"
                    inputMode="decimal"
                    value={spendIn === "coin" ? coinsTyped : form.base}
                    onChange={(e) => {
                      if (spendIn === "coin") {
                        setCoins(e.target.value);
                        set("base", floor(Number(e.target.value) * Number(form.entry), "0.01"));
                      } else set("base", e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    className="unit-toggle"
                    title="Switch between spending in the quote and buying a number of coins"
                    onClick={() => {
                      if (spendIn === "quote") {
                        setCoins(floor(Number(form.base) / Number(form.entry), terminal.step));
                        setSpendIn("coin");
                      } else setSpendIn("quote");
                    }}
                  >
                    {spendIn === "coin" ? terminal.base : q} ⇄
                  </button>
                </div>
                {spendIn === "coin" ? (
                  <div className="dca-reason muted">
                    {two.format(Number(form.base) || 0)} {q}
                  </div>
                ) : (
                  why.base && <div className="dca-reason">{why.base}</div>
                )}
              </div>
            </div>
            <button
              type="button"
              className="link st-now"
              disabled={off || unset || !(Number(form.base) > 0)}
              onClick={() => {
                setError("");
                quick.current?.showModal?.();
              }}
            >
              Or place this one buy now, without DCA or exits
            </button>
          </>
        )}
        {step === 1 && (
          <div>
            {toggle("dcaOn", "Buy more if it dips")}
            {form.dcaOn && (
              <div className="dca-two">
                {field("count", "DCA orders", "orders")}
                {field("deviation", "Deviation", "%")}
                {field("dca", "DCA order", q)}
                {field("sizeMult", "DCA size multiplier", "×")}
              </div>
            )}
          </div>
        )}
        {step === 2 && (
          <div>
            {toggle("tpOn", "Take profit")}
            {form.tpOn && field("tp", "Take profit over the average", "%")}
            {form.tpOn && tpFirst > 0 && (
              <div className="dca-now muted">
                Sells at {price(String(tpFirst))} if only the entry fills; it moves down to the new
                average as DCA orders fill.
              </div>
            )}
          </div>
        )}
        {step === 3 && (
          <div>
            {toggle("slOn", "Stop loss")}
            {form.slOn && field("sl", "Sell everything under", q)}
            {form.slOn && sl > 0 && average > 0 && (
              <div className="dca-now muted">
                {((1 - sl / average) * 100).toFixed(1)}% under the average if every order fills. It
                sells at market once the price is under it.
              </div>
            )}
          </div>
        )}

        <div className="sum">
          <div className="kv">
            <span className="muted">Total if all fill · average</span>
            <span className="num">
              {total > 0 ? `${two.format(total)} ${q} · ${price(String(average))}` : "–"}
            </span>
          </div>
          <div className="kv">
            <span className="muted">Available</span>
            <span className="num">
              {two.format(Number(terminal.quoteFree))} {q}
            </span>
          </div>
        </div>
        <LimitsLine settings={settings} quote={q} onSaved={onSettings} />
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="dca-nav">
          <button className="btn" type="button" onClick={step ? () => setStep(step - 1) : onCancel}>
            {step ? "Back" : "Cancel"}
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn btn-accent" type="button" onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button
              className="btn btn-accent"
              type="button"
              disabled={off || unset || presetting || !rows.length}
              onClick={() => {
                setError("");
                dialog.current?.showModal?.();
              }}
            >
              {off ? "Trading is off" : unset ? "Set your limits first" : "Review trade"}
            </button>
          )}
        </div>
      </section>

      <section className="card dca-preview" aria-label="Trade chart">
        {market && market.candles.length > 1 ? (
          <BotChart
            candles={market.candles}
            levels={levels}
            height={340}
            label={`${terminal.pair} candles with this trade's entry, DCA orders and exits`}
          />
        ) : (
          <div className="skeleton" style={{ height: 340 }} />
        )}
        <div className="dca-tiles">
          <div>
            <span className="label">Total if all fill</span>
            <b className="num">{total > 0 ? `${two.format(total)} ${q}` : "–"}</b>
          </div>
          <div>
            <span className="label">If take profit fills</span>
            <b className="num up">{reward > 0 ? `+${two.format(reward)} ${q}` : "–"}</b>
            {reward > 0 && <small className="muted">{pct(reward)}</small>}
          </div>
          <div>
            <span className="label">If stop loss fills</span>
            <b className="num down">{risk > 0 ? `−${two.format(risk)} ${q}` : "–"}</b>
            {risk > 0 && <small className="muted">{pct(risk)}</small>}
          </div>
          <div>
            <span className="label">Reward to risk</span>
            <b className="num">
              {reward > 0 && risk > 0 ? `${(reward / risk).toFixed(1)} : 1` : "–"}
            </b>
          </div>
        </div>
        {resistance > 0 && tpFirst > resistance && (
          <p className="dca-hint wait">
            Take profit sits above resistance at {price(String(resistance))}: it may stall there.
          </p>
        )}
        {signal && (
          <p className="dca-hint">
            The AI signal says {signal.verdict} at {signal.confidence}% confidence. It advises; you
            decide.
          </p>
        )}
      </section>

      <dialog ref={quick} aria-labelledby="st-quick">
        <h2 id="st-quick">
          Limit buy {quickQty} {terminal.base} at {price(form.entry)}?
        </h2>
        <p>
          {two.format(Number(form.base) || 0)} {q}, one order with no DCA orders and no exits. It
          sits in Open orders until it fills or you cancel it.
        </p>
        <div className="dlg-btns">
          <button className="btn" type="button" onClick={() => quick.current?.close?.()}>
            Back
          </button>
          <button className="btn btn-accent" type="button" disabled={sending} onClick={placeNow}>
            {sending ? "Sending" : "Place limit buy"}
          </button>
        </div>
      </dialog>
      <dialog ref={dialog} aria-labelledby="st-confirm">
        <h2 id="st-confirm">
          Place {rows.length} limit {rows.length === 1 ? "buy" : "buys"} of {terminal.base}?
        </h2>
        <p>
          Entry at {price(form.entry)}
          {rows.length > 1 &&
            `, then ${rows.length - 1} DCA orders down to ${price(String(rows[rows.length - 1]?.price ?? 0))}`}
          : up to {two.format(total)} {q}.{" "}
          {form.tpOn ? `Take profit ${form.tp}% over the average.` : "No take profit."}{" "}
          {form.slOn ? `Sells everything at market under ${price(form.sl)}.` : "No stop loss."}
        </p>
        <p className="label">
          The orders go to Binance now. Once its one deal ends, the trade is finished.
        </p>
        <div className="dlg-btns">
          <button className="btn" type="button" onClick={() => dialog.current?.close?.()}>
            Back
          </button>
          <button
            className="btn btn-accent"
            type="button"
            disabled={sending}
            onClick={() => void place()}
          >
            {sending ? "Sending" : "Place trade"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function SellForm({
  start,
  terminal,
  settings,
  market,
  signal,
  onCancel,
  onPlaced,
}: {
  terminal: Terminal;
  settings: Settings;
  market: Market | null;
  signal: Signal | null;
  onCancel: () => void;
  onPlaced: (note: string) => void;
  start?: string;
}) {
  const resistance = Number(market?.indicators.resistance ?? signal?.resistance ?? 0);
  const [at, setAt] = useState(() =>
    start && Number(start) > 0
      ? floor(Number(start), terminal.tick)
      : floor(
          resistance > Number(terminal.price) ? resistance : Number(terminal.price),
          terminal.tick,
        ),
  );
  const [qty, setQty] = useState("");
  const [error, setError] = useState("");
  const [id, setId] = useState(() => crypto.randomUUID());
  const send = () => {
    placeOrder({
      clientId: id,
      symbol: terminal.symbol,
      side: "sell",
      price: at,
      amount: qty,
    }).then(
      (d) => {
        setId(crypto.randomUUID());
        onPlaced(d.message);
      },
      (e: unknown) => setError(message(e)),
    );
  };
  return (
    <section className="card dca-wizard st-sell" aria-label="Sell">
      <div className="dca-two">
        <div className="field">
          <label htmlFor="sell-price">Limit price</label>
          <div className="in">
            <input
              id="sell-price"
              className="num"
              inputMode="decimal"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
            <span className="muted">{terminal.quote}</span>
          </div>
          <div className="dca-reason">
            {start
              ? "From the AI plan's trim zone"
              : resistance > Number(terminal.price)
                ? "Resistance from recent candles"
                : "Today's price"}
          </div>
        </div>
        <div className="field">
          <label htmlFor="sell-qty">Amount</label>
          <div className="in">
            <input
              id="sell-qty"
              className="num"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <span className="muted">{terminal.base}</span>
          </div>
          <div className="pcts">
            {[0.25, 0.5, 1].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setQty(floor(Number(terminal.baseFree) * f, terminal.step))}
              >
                {f === 1 ? "Max" : `${f * 100}%`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="kv">
        <span className="muted">Order value · held</span>
        <span className="num">
          {two.format(Number(at) * Number(qty) || 0)} {terminal.quote} ·{" "}
          {coinAmount(terminal.baseFree)} {terminal.base}
        </span>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dca-nav">
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-accent"
          type="button"
          disabled={!settings.tradingOn || !(Number(qty) > 0)}
          onClick={send}
        >
          Place limit sell
        </button>
      </div>
    </section>
  );
}

// The limits, one line; Edit opens the two fields in place.
function LimitsLine({
  settings,
  quote,
  onSaved,
}: {
  settings: Settings;
  quote: string;
  onSaved: (s: Settings) => void;
}) {
  const unset = Number(settings.perOrder) <= 0 || Number(settings.perDay) <= 0;
  const [editing, setEditing] = useState(unset);
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
  if (!editing) {
    return (
      <div className="kv st-limits">
        <span className="muted">
          Limits {two.format(Number(settings.perOrder))} an order ·{" "}
          {two.format(Number(settings.leftToday))} of {two.format(Number(settings.perDay))} left
          today
        </span>
        <button className="link" type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }
  return (
    <div className="st-limits-edit">
      <div className="dca-two">
        <div className="field">
          <label htmlFor="per-order">Per order ({quote})</label>
          <div className="in">
            <input
              id="per-order"
              className="num"
              inputMode="decimal"
              value={perOrder}
              onChange={(e) => setPerOrder(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="per-day">Per day ({quote})</label>
          <div className="in">
            <input
              id="per-day"
              className="num"
              inputMode="decimal"
              value={perDay}
              onChange={(e) => setPerDay(e.target.value)}
            />
          </div>
        </div>
      </div>
      {unset && <div className="dca-reason">Nothing trades until you set these.</div>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div
        className="row-actions"
        style={{ justifyContent: "flex-start", width: "auto", marginTop: 8 }}
      >
        <button className="btn btn-small" type="button" onClick={save}>
          Save limits
        </button>
        {!unset && (
          <button className="btn btn-small" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function TradesTable({
  terminal,
  trades,
  onChanged,
}: {
  terminal: Terminal;
  trades: Trades | null;
  onChanged: (problem?: string) => void;
}) {
  const [tab, setTab] = useState<"active" | "history" | "orders">("active");
  const [open, setOpen] = useState<number | null>(null);
  const [detail, setDetail] = useState<DcaDetail | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const q = terminal.quote;
  const all = trades?.bots ?? [];
  const active = all.filter((t) => t.enabled || t.deals.length > 0);
  const history = all.filter((t) => !t.enabled && t.deals.length === 0);
  const shown = tab === "active" ? active : history;
  const act = (work: Promise<unknown>) =>
    work.then(
      () => onChanged(),
      (e: unknown) => onChanged(message(e)),
    );
  const expand = (t: DcaBot) => {
    if (open === t.id) {
      setOpen(null);
      return;
    }
    setOpen(t.id);
    setDetail(null);
    getBot(t.id).then(setDetail, () => setDetail(null));
  };
  const tabs: [typeof tab, string][] = [
    ["active", `Active (${active.length})`],
    ["history", `History (${history.length})`],
    ["orders", `Open orders (${terminal.openOrders.length})`],
  ];
  return (
    <section className="st-trades" aria-label="Smart trades">
      <div className="seg bot-filter" role="tablist" aria-label="Trades">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? "on" : ""}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "orders" ? (
        terminal.openOrders.length === 0 ? (
          <p className="muted empty">No open orders.</p>
        ) : (
          <div className="card scroll">
            <table className="bot-table">
              <thead>
                <tr>
                  <th scope="col">Pair</th>
                  <th scope="col">Side</th>
                  <th scope="col" className="r">
                    Price
                  </th>
                  <th scope="col" className="r">
                    Amount
                  </th>
                  <th scope="col" className="r">
                    Placed
                  </th>
                  <th scope="col" className="r">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {terminal.openOrders.map((o) => (
                  <tr key={o.orderId}>
                    <td>{o.pair}</td>
                    <td className={o.side === "Buy" ? "up" : "down"}>{o.side}</td>
                    <td className="r num">{price(o.price)}</td>
                    <td className="r num">{coinAmount(o.amount)}</td>
                    <td className="r muted">{dateTime(o.time)}</td>
                    <td className="r">
                      <button
                        className="btn btn-small"
                        type="button"
                        onClick={() => act(cancelOrder(o.symbol, o.orderId))}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : shown.length === 0 ? (
        <p className="muted empty">
          {tab === "active"
            ? "No active trades. Start one with New trade."
            : "No finished trades yet."}
        </p>
      ) : (
        <div className="card scroll">
          <table className="bot-table">
            <thead>
              <tr>
                <th scope="col">Trade</th>
                <th scope="col">Entry · DCA</th>
                <th scope="col" className="r">
                  Spent · average
                </th>
                <th scope="col" className="r">
                  Take profit · stop loss
                </th>
                <th scope="col" className="r">
                  PnL
                </th>
                <th scope="col" className="r">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const c = t.config;
                const deal = t.deals[0];
                const pnl = deal ? Number(deal.unrealised ?? 0) : Number(t.profit);
                return (
                  <tr key={t.id}>
                    <td>
                      <button type="button" className="coin card-open" onClick={() => expand(t)}>
                        <CoinIcon coin={t.symbol.slice(0, -q.length)} />
                        <span>
                          <b>{t.pair}</b>
                          <span className="ref">{t.ref}</span>
                          <span className="muted st-note">
                            {t.note ?? (deal ? "Running" : "Waiting")}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="num">
                      {price(c.entryPrice ?? null)}
                      <div className="muted">
                        {c.maxDcaOrders} DCA · {c.deviation}% apart
                      </div>
                    </td>
                    <td className="r num">
                      {deal ? quoteAmount(deal.spent, q) : "–"}
                      <div className="muted">{deal ? price(deal.average) : ""}</div>
                    </td>
                    <td className="r num">
                      <span className="up">
                        {c.takeProfitOn
                          ? deal?.takeProfit
                            ? price(deal.takeProfit)
                            : `${c.takeProfit}%`
                          : "Off"}
                      </span>
                      <div className="down">{c.stopLoss ? price(c.stopLoss) : "Off"}</div>
                    </td>
                    <td className={`r num ${pnl > 0 ? "up" : pnl < 0 ? "down" : ""}`}>
                      {quoteAmount(String(pnl), q, true)}
                    </td>
                    <td className="r">
                      <div className="row-actions">
                        <button className="btn btn-small" type="button" onClick={() => expand(t)}>
                          {open === t.id ? "Hide" : "Details"}
                        </button>
                        {t.enabled && !deal?.baseFilled && (
                          <button
                            className="btn btn-small"
                            type="button"
                            onClick={() => act(switchBot(t.id, false))}
                          >
                            Cancel
                          </button>
                        )}
                        {deal?.baseFilled &&
                          (asking === t.id ? (
                            <>
                              <button
                                className="btn btn-small"
                                type="button"
                                onClick={() => act(closeBot(t.id))}
                              >
                                Sell all at market
                              </button>
                              <button
                                className="btn btn-small"
                                type="button"
                                onClick={() => setAsking(null)}
                              >
                                Keep
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-small"
                              type="button"
                              onClick={() => setAsking(t.id)}
                            >
                              Close
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open !== null && detail && detail.bot.id === open && (
        <div className="st-detail">
          {detail.deals.length === 0 ? (
            <p className="muted empty">Nothing placed yet.</p>
          ) : (
            detail.deals.map((d) => <DealCard key={d.id} deal={d} quote={q} />)
          )}
        </div>
      )}
    </section>
  );
}
