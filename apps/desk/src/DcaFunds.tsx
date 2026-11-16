// Add funds and Remove funds on the DCA book (TODO 11). Name an amount, ask dca-agent, and it
// returns one limit order per coin: its share, its price and why, with the desk's odds of a
// fill within 24 hours. Change any share or price by hand, or tell the agent what to change.
import { useRef, useState } from "react";
import { ApiError, analyseFunds, chatFunds, fundsOdds, placeDcaOrder } from "./api";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import { limit, two } from "./dcaFormat";
import type { FundsOrder, FundsPlan } from "./types";

type Side = "add" | "remove";
type Row = FundsOrder & { result?: string; failed?: boolean; skipped?: boolean };
const MIN = 10; // the agent's rule: 10 USDC a coin at least
type Line = { who: "you" | "agent"; text: string };

const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
// The odds as a person reads them: how likely, how far from now, and a plain sentence on hover.
// windows are 24-hour stretches starting every 4 hours, so six make a day of history.
function Odds({ row, selling }: { row: Row; selling: boolean }) {
  const pct = row.odds.pct;
  const gap = (Number(row.price) / Number(row.now) - 1) * 100;
  const days = Math.round(row.odds.windows / 6);
  const short = days < 180;
  const move = `${selling ? "rose" : "fell"} ${Math.abs(gap).toFixed(1)}%`;
  const title =
    pct === null
      ? "No price history to judge this by."
      : `Over the last ${short ? `${days} days` : "year"}, starting at any hour, ${row.coin} ${move} or more within a day ${pct}% of the time.`;
  return (
    <span className={`dcf-odds${pct !== null && pct < 75 ? " is-low" : ""}`} title={title}>
      <b>{pct === null ? "—" : `${pct}%`}</b>
      <i aria-hidden="true">
        <span style={{ width: `${pct ?? 0}%` }} />
      </i>
      <small>
        {gap === 0
          ? "at market"
          : `${Math.abs(gap).toFixed(1)}% ${gap < 0 ? "below" : "above"} now`}
        {short && pct !== null ? `, ${days} days of history` : ""}
      </small>
    </span>
  );
}

// The split in words, for the bar's label: "BTC 50%, SOL 26%, ZEC 24%".
function splitWords(rows: Row[], quote: string): string {
  const shown = rows.filter((r) => !r.skipped && Number(r.usdc) > 0);
  const sum = shown.reduce((s, r) => s + Number(r.usdc), 0) || 1;
  const parts = shown.map((r) => `${r.coin} ${Math.round((Number(r.usdc) * 100) / sum)}%`);
  return `The split of ${sum.toFixed(2)} ${quote}: ${parts.join(", ")}`;
}

export default function DcaFunds({
  side: first,
  quote,
  onClose,
  onPlaced,
}: {
  side: Side;
  quote: string;
  onClose: () => void;
  onPlaced: (said: string) => void;
}) {
  const [side, setSide] = useState<Side>(first);
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState<FundsPlan | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<"analyse" | "chat" | "place" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  const selling = side === "remove";
  const total = rows.reduce((s, r) => s + (Number(r.usdc) || 0), 0);
  const asked = Number(amount) || 0;
  const pending = rows.filter((r) => !r.result && !r.skipped && Number(r.usdc) > 0);
  const tooSmall = pending.filter((r) => Number(r.usdc) < MIN).map((r) => r.coin);

  const take = (p: FundsPlan) => {
    setPlan(p);
    setRows([...p.orders, ...(p.skipped ?? []).map((s) => ({ ...s, skipped: true }))]);
    setAmount(p.amount);
  };
  const analyse = () => {
    setBusy("analyse");
    setError(null);
    setLines([]);
    analyseFunds(side, amount).then(
      (p) => {
        take(p);
        setBusy(null);
      },
      (e: unknown) => {
        setError(errorOf(e, "dca-agent couldn't plan that."));
        setBusy(null);
      },
    );
  };
  const send = () => {
    const text = message.trim();
    if (!text) return;
    setBusy("chat");
    setError(null);
    const history = lines;
    setLines([...history, { who: "you", text }]);
    setMessage("");
    chatFunds({
      side,
      amount,
      orders: rows.map(({ coin, usdc, price, reason, skipped }) => ({
        coin,
        usdc: skipped ? "0" : usdc,
        price,
        reason,
      })),
      history,
      message: text,
    }).then(
      (p) => {
        take(p);
        setLines((l) => [...l, { who: "agent", text: p.reply ?? p.note }]);
        setBusy(null);
      },
      (e: unknown) => {
        setLines((l) => [...l, { who: "agent", text: errorOf(e, "That didn't reach dca-agent.") }]);
        setBusy(null);
      },
    );
  };

  // Hand edits: a share and its USDC move together; a new price fetches its odds.
  const edit = (i: number, change: Partial<Row>) =>
    setRows((r) => r.map((x, k) => (k === i ? { ...x, ...change } : x)));
  // A share on a left-out coin brings it back in; clearing one leaves it out.
  const setPct = (i: number, pct: string) => {
    const usdc = asked ? ((asked * (Number(pct) || 0)) / 100).toFixed(2) : "0";
    edit(i, { pct, usdc, skipped: !(Number(usdc) > 0) });
  };
  const setUsdc = (i: number, usdc: string) =>
    edit(i, {
      usdc,
      pct: asked ? (((Number(usdc) || 0) * 100) / asked).toFixed(1) : "0",
      skipped: !(Number(usdc) > 0),
    });
  const reOdds = (i: number) => {
    const r = rows[i];
    if (!r || !(Number(r.price) > 0)) return;
    fundsOdds(r.coin, r.price, side).then(
      (o) => edit(i, { odds: o, now: o.now }),
      () => undefined,
    );
  };

  const place = async (override = false) => {
    setBusy("place");
    setHeld(null);
    const next = [...rows];
    for (const [i, r] of next.entries()) {
      if (r.result || r.skipped || !(Number(r.usdc) > 0)) continue; // left-out coins stay out
      try {
        const placed = await placeDcaOrder(
          selling
            ? {
                coin: r.coin,
                side: "sell",
                qty: String(Math.floor((Number(r.usdc) / Number(r.price)) * 1e8) / 1e8),
                price: r.price,
                source: "trim",
              }
            : { coin: r.coin, spend: r.usdc, price: r.price, source: "named", override },
        );
        next[i] = { ...r, result: placed.ref };
      } catch (e) {
        if (e instanceof ApiError && e.ruleBreaks.length) {
          setHeld(e.message);
          break;
        }
        next[i] = { ...r, result: errorOf(e, "Not placed."), failed: true };
      }
      setRows([...next]);
    }
    setBusy(null);
    dialog.current?.close?.();
    const done = next.filter((r) => r.result && !r.failed).length;
    if (done)
      onPlaced(
        `${done} ${selling ? "limit sells" : "limit buys"} placed from ${two(asked)} ${quote}.`,
      );
  };

  return (
    <section className="dcf" aria-labelledby="dcf-title">
      <div className="dcf-head">
        <h2 id="dcf-title">{selling ? "Remove funds" : "Add funds"}</h2>
        <div className="dcb-seg" role="group" aria-label="Add or remove">
          {(["add", "remove"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => {
                setSide(s);
                setPlan(null);
                setRows([]);
                setLines([]);
              }}
            >
              {s === "add" ? "Add" : "Remove"}
            </button>
          ))}
        </div>
        <button type="button" className="link dcf-close" onClick={onClose}>
          Close
        </button>
      </div>

      <form
        className="dcf-ask"
        onSubmit={(e) => {
          e.preventDefault();
          analyse();
        }}
      >
        <label className="dcf-amount">
          <span>{selling ? "Amount to take out" : "Amount to put in"}</span>
          <span className="dcf-unit">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={`Amount in ${quote}`}
            />
            <small>{quote}</small>
          </span>
        </label>
        <button type="submit" className="btn btn-accent" disabled={!(asked > 0) || busy !== null}>
          {busy === "analyse" ? "dca-agent is reading the market…" : "Analyse with dca-agent"}
        </button>
        <p className="muted dcf-hint">
          {selling
            ? "It picks the coins likeliest to dip so you can buy back lower, with limit sells that fill within 24 hours four times in five."
            : "It splits the amount across your coins, one limit buy each, priced to fill within 24 hours four times in five."}
        </p>
      </form>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {plan && (
        <>
          <div className="dcf-note">
            <AgentAvatar icon="dca" slug="dca-agent" />
            <p>
              {plan.by === "desk" && <span className="dcb-warn">From the desk alone. </span>}
              {plan.note}
            </p>
          </div>
          {plan.said.length > 0 && (
            <ul className="dcf-said">
              {plan.said.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
          <div className="dcf-split" role="img" aria-label={splitWords(rows, quote)}>
            {rows
              .filter((r) => !r.skipped && Number(r.usdc) > 0)
              .map((r, i) => (
                <span
                  key={r.coin}
                  className={`dcf-seg tone-${(i % 5) + 1}`}
                  style={{ flexGrow: Number(r.usdc) }}
                >
                  <b>{r.coin}</b> {Math.round((Number(r.usdc) * 100) / Math.max(total, 1))}%
                </span>
              ))}
          </div>
          <div className="dcb-scroll">
            <table
              className="dcb-table dcf-table"
              aria-label={selling ? "Limit sells" : "Limit buys"}
            >
              <thead>
                <tr>
                  <th>Coin</th>
                  <th className="r">Share %</th>
                  <th className="r">{quote}</th>
                  <th className="r">Limit</th>
                  <th>Likely to fill in 24h</th>
                  <th>Why this price</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.coin} className={r.skipped ? "is-skipped" : ""}>
                    <td>
                      <span className="dcb-coin">
                        <CoinIcon coin={r.coin} />
                        {r.coin}
                      </span>
                      <small className="dcb-id">now {limit(r.now)}</small>
                    </td>
                    <td className="r">
                      <input
                        className="dcb-num dcf-pct"
                        aria-label={`${r.coin} share`}
                        inputMode="decimal"
                        value={r.skipped ? "" : r.pct}
                        placeholder="0"
                        disabled={Boolean(r.result)}
                        onChange={(e) => setPct(i, e.target.value)}
                      />
                    </td>
                    <td className="r">
                      <input
                        className="dcb-num"
                        aria-label={`${r.coin} amount`}
                        inputMode="decimal"
                        value={r.skipped ? "" : r.usdc}
                        placeholder="0"
                        disabled={Boolean(r.result)}
                        onChange={(e) => setUsdc(i, e.target.value)}
                      />
                    </td>
                    <td className="r">
                      <input
                        className="dcb-num"
                        aria-label={`${r.coin} limit price`}
                        inputMode="decimal"
                        value={r.price}
                        disabled={Boolean(r.result)}
                        onChange={(e) => edit(i, { price: e.target.value })}
                        onBlur={() => reOdds(i)}
                      />
                    </td>
                    <td>
                      <Odds row={r} selling={selling} />
                    </td>
                    <td className={`dcf-why ${r.failed ? "error-text" : ""}`}>
                      {r.skipped && <span className="dcf-out">Left out. </span>}
                      {!r.skipped && !r.result && Number(r.usdc) > 0 && Number(r.usdc) < MIN && (
                        <span className="dcb-warn">
                          Under {MIN} {quote}: raise it or clear it.{" "}
                        </span>
                      )}
                      {r.result ?? r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td />
                  <td className={`r num ${Math.abs(total - asked) > 0.01 ? "wait" : ""}`}>
                    {two(total)}
                  </td>
                  <td colSpan={3} className="muted">
                    {Math.abs(total - asked) > 0.01 ? `of ${two(asked)} asked` : ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="dcb-note">
            Likely to fill: how often, over the last year, the price {selling ? "rose" : "fell"}{" "}
            that far within a day, from any starting hour. 80% is about four days in five.
          </p>

          <div className="dcf-chat" aria-label="Talk to dca-agent">
            {lines.length > 0 && (
              <ol className="dcf-lines" aria-live="polite">
                {lines.map((l, i) => (
                  <li key={i} className={`is-${l.who}`}>
                    {l.text}
                  </li>
                ))}
              </ol>
            )}
            <form
              className="dcf-say"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell dca-agent what to change: more BTC, SOL a bit deeper…"
                aria-label="Message to dca-agent"
                maxLength={500}
              />
              <button type="submit" className="btn" disabled={!message.trim() || busy !== null}>
                {busy === "chat" ? "Thinking…" : "Send"}
              </button>
            </form>
          </div>

          {held && (
            <div className="alert" role="alert">
              <span>{held}</span>
              <button type="button" className="btn btn-small" onClick={() => void place(true)}>
                Place anyway (logged)
              </button>
            </div>
          )}
          <div className="dcf-foot">
            <button
              type="button"
              className="btn btn-accent"
              disabled={pending.length === 0 || tooSmall.length > 0 || busy !== null}
              onClick={() => dialog.current?.showModal?.()}
            >
              Review {pending.length} {selling ? "limit sells" : "limit buys"}
            </button>
          </div>
        </>
      )}

      <dialog ref={dialog} aria-labelledby="dcf-confirm">
        <h2 id="dcf-confirm">
          Place {pending.length} {selling ? "limit sells" : "limit buys"} for {two(total)} {quote}?
        </h2>
        <p>
          {pending.map((r) => `${r.coin} ${two(r.usdc)} at ${limit(r.price)}`).join("; ")}.
          {selling
            ? " Each sale is a taxable event; buy it back from the order list once it fills."
            : " They go to Binance now and wait for their price."}
        </p>
        <div className="dlg-btns">
          <button className="btn" type="button" onClick={() => dialog.current?.close()}>
            Not yet
          </button>
          <button
            className={`btn ${selling ? "btn-danger" : "btn-accent"}`}
            type="button"
            disabled={busy !== null}
            onClick={() => void place()}
          >
            Place {pending.length}
          </button>
        </div>
      </dialog>
    </section>
  );
}
