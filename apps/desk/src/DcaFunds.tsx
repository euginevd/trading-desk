// Add funds and Remove funds on the DCA book (TODO 11), laid out like the week's planner. Name an
// amount and the desk plans it at once: one limit per coin, by your targets, priced to fill within
// 24 hours four times in five. Tick, change any price or amount, or ask dca-agent to adjust it.
import { useRef, useState } from "react";
import { ApiError, analyseFunds, chatFunds, fundsOdds, placeDcaOrder } from "./api";
import CoinIcon from "./CoinIcon";
import OrderReview from "./OrderReview";
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
  const [talking, setTalking] = useState(false);
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
        setError(errorOf(e, "The desk couldn't plan that."));
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
  const setUsdc = (i: number, usdc: string) => edit(i, { usdc, skipped: !(Number(usdc) > 0) });
  // Ticking a left-out coin brings it in at the minimum; unticking leaves it out.
  const tick = (i: number, on: boolean) => {
    const r = rows[i];
    if (!r) return;
    edit(
      i,
      on ? { skipped: false, usdc: Number(r.usdc) > 0 ? r.usdc : String(MIN) } : { skipped: true },
    );
  };
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
          {busy === "analyse" ? "Planning…" : plan ? "Plan again" : "Plan it"}
        </button>
        <p className="muted dcf-hint">
          {selling
            ? "The desk takes from the hottest coins first, a quarter of a position at most, with limit sells that fill within 24 hours four times in five."
            : "The desk splits it by your targets, one limit a coin, priced to fill within 24 hours four times in five."}
        </p>
      </form>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {plan && (
        <>
          {(plan.note || plan.said.length > 0) && (
            <div className="dcf-note">
              {plan.note && <p>{plan.note}</p>}
              {plan.said.map((x) => (
                <p key={x} className="muted">
                  {x}
                </p>
              ))}
            </div>
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
                  <th>
                    <span className="visually-hidden">Place</span>
                  </th>
                  <th>Coin</th>
                  <th className="r">Limit</th>
                  <th className="r">{quote}</th>
                  <th>Fill in 24h</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.coin} className={r.skipped ? "is-skipped" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Place ${r.coin}`}
                        checked={!r.skipped}
                        disabled={Boolean(r.result)}
                        onChange={(e) => tick(i, e.target.checked)}
                      />
                    </td>
                    <td>
                      <span className="dcb-coin">
                        <CoinIcon coin={r.coin} />
                        {r.coin}
                      </span>
                      <small className="dcb-id">now {limit(r.now)}</small>
                    </td>
                    <td className="r">
                      <input
                        className="dcb-num"
                        aria-label={`${r.coin} limit price`}
                        inputMode="decimal"
                        value={r.price}
                        disabled={Boolean(r.result) || r.skipped}
                        onChange={(e) => edit(i, { price: e.target.value })}
                        onBlur={() => reOdds(i)}
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
                    <td>
                      <Odds row={r} selling={selling} />
                    </td>
                    <td className={`dcf-why ${r.failed ? "error-text" : "muted"}`}>
                      {r.result ??
                        (r.skipped
                          ? r.reason
                          : Number(r.usdc) > 0 && Number(r.usdc) < MIN
                            ? `Under ${MIN} ${quote}: raise it or untick it.`
                            : "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dcb-note">
            Total {two(total)} of {two(asked)} {quote}. Fill in 24h: how often, over the last year,
            the price {selling ? "rose" : "fell"} that far within a day.
          </p>

          {talking && (
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
                  placeholder="More BTC, SOL a bit deeper, skip HYPE…"
                  aria-label="Ask dca-agent about this split"
                  maxLength={500}
                />
                <button type="submit" className="btn" disabled={!message.trim() || busy !== null}>
                  {busy === "chat" ? "Thinking…" : "Send"}
                </button>
              </form>
            </div>
          )}

          {held && (
            <div className="alert" role="alert">
              <span>{held}</span>
              <button type="button" className="btn btn-small" onClick={() => void place(true)}>
                Place anyway (logged)
              </button>
            </div>
          )}
          <div className="dcb-plan-foot">
            {talking ? (
              <span />
            ) : (
              <button type="button" className="link" onClick={() => setTalking(true)}>
                Ask dca-agent to adjust
              </button>
            )}
            <button
              type="button"
              className="btn btn-accent"
              disabled={pending.length === 0 || tooSmall.length > 0 || busy !== null}
              onClick={() => dialog.current?.showModal?.()}
            >
              Review {pending.length} {pending.length === 1 ? "limit" : "limits"}
            </button>
          </div>
        </>
      )}

      <dialog ref={dialog} aria-labelledby="dcf-confirm">
        <h2 id="dcf-confirm">
          Place {pending.length} {selling ? "limit sells" : "limit buys"}?
        </h2>
        <OrderReview
          quote={quote}
          items={pending.map((r) => ({
            coin: r.coin,
            action: selling ? "Sell" : "Buy",
            price: r.price,
            usdc: r.usdc,
            odds: r.odds.pct,
          }))}
          note={
            selling
              ? "Each sale is a taxable event. Buy it back from the order list once it fills."
              : "They go to Binance now and wait for their price."
          }
        />
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
