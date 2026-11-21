// Add funds to one position (owner, 21 Nov 2026), on the Trade page and the DCA book alike, in
// the shape of the book's Add funds: an amount, "Plan it", the split as one bar, then one row
// per limit with its price, amount and fill odds, each editable or left out. The desk plans an
// entry that fills within the hour and limits under it at support; "re-plan" cancels the
// position's waiting limits and plans their money again with what's added.
import { useEffect, useRef, useState } from "react";
import { dollars, limit, roundPrice } from "./dcaFormat";
import { errorOf } from "./format";
import AgentChat from "./AgentChat";
import type { LadderPreview, LadderRequest, StrategizeReply } from "./types";

// What the agent is asked with: the caller adds the book, coin and position.
export type Ask = (body: {
  message: string;
  history: { who: string; text: string }[];
  rows: { price: string; amount: string; why: string }[];
  total?: string;
}) => Promise<StrategizeReply>;

type Row = { price: string; spend: string; why: string; on: boolean };
const MIN = 10;

export default function CoinFunds({
  coin,
  quote = "USDC",
  waiting,
  preview,
  place,
  agent,
  strategize,
  onClose,
  onPlaced,
}: {
  coin: string;
  quote?: string;
  waiting: { count: number; usd: number }; // the position's limits still waiting
  preview: (body: LadderRequest) => Promise<LadderPreview>;
  place: (body: LadderRequest & { anyway: boolean; override: boolean }) => Promise<unknown>;
  agent?: string;
  strategize?: Ask;
  onClose: () => void;
  onPlaced: (said: string) => void;
}) {
  const [amount, setAmount] = useState("20");
  const [replace, setReplace] = useState(false);
  const [seen, setSeen] = useState<LadderPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState<"plan" | "place" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = useRef(0);
  const again = replace ? { replace: true } : {};

  const fetchPlan = () => {
    const mine = ++ask.current;
    preview({ coin, total: amount, ...again }).then(
      (p) => {
        if (mine !== ask.current) return;
        setBusy(null);
        setSeen(p);
        setRows(p.rungs.map((r) => ({ price: r.price, spend: r.spend, why: r.why, on: true })));
      },
      (e: unknown) => {
        if (mine !== ask.current) return;
        setBusy(null);
        setError(errorOf(e, "No limits could be planned."));
      },
    );
  };
  const plan = () => {
    setBusy("plan");
    setError(null);
    fetchPlan();
  };
  // Planned once on open, and again when re-planning the waiting limits is ticked.
  useEffect(fetchPlan, [replace]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = rows.filter((r) => r.on);
  // An edit, or a limit left out: the same limits read again for their odds and the rules.
  const reread = (next: Row[]) => {
    setRows(next);
    const kept = next.filter((r) => r.on);
    if (!kept.length) return;
    const mine = ++ask.current;
    window.setTimeout(() => {
      if (mine !== ask.current) return;
      preview({ coin, rungs: kept, ...again }).then(
        (p) => {
          if (mine !== ask.current) return;
          setSeen(p);
          setError(null);
        },
        (e: unknown) => mine === ask.current && setError(errorOf(e, "Those limits can't be read.")),
      );
    }, 400);
  };
  const edit = (i: number, change: Partial<Row>) =>
    reread(rows.map((r, k) => (k === i ? { ...r, ...change } : r)));

  // The preview's rows follow the ticked ones, in order.
  const seenOf = (i: number) => {
    const at = rows.slice(0, i + 1).filter((r) => r.on).length - 1;
    return rows[i]?.on ? seen?.rungs[at] : undefined;
  };
  const total = live.reduce((s, r) => s + (Number(r.spend) || 0), 0);
  const problems = seen?.problems ?? [];
  const warnings = seen?.warnings ?? [];
  const tooSmall = live.some((r) => Number(r.spend) < MIN);
  const go = () => {
    setBusy("place");
    setError(null);
    place({ coin, rungs: live, ...again, anyway, override: anyway }).then(
      () => {
        setBusy(null);
        onPlaced(
          `${live.length} ${live.length === 1 ? "limit" : "limits"} for ${coin} on Binance${replace ? `, replacing its ${waiting.count} waiting` : ""}.`,
        );
      },
      (e: unknown) => {
        setBusy(null);
        setError(errorOf(e, "The limits weren't placed."));
      },
    );
  };

  return (
    <section className="dcf cf" aria-label={`Add funds to ${coin}`}>
      <div className="dcf-head">
        <h2>Add funds · {coin}</h2>
        <button type="button" className="link dcf-close" onClick={onClose}>
          Close
        </button>
      </div>

      <form
        className="dcf-ask"
        onSubmit={(e) => {
          e.preventDefault();
          plan();
        }}
      >
        <label className="dcf-amount">
          <span>Amount to put in</span>
          <span className="dcf-unit">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              aria-label={`Amount in ${quote}`}
            />
            <small>{quote}</small>
          </span>
        </label>
        <button type="submit" className="btn btn-accent" disabled={busy !== null}>
          {busy === "plan" ? "Planning…" : seen ? "Plan again" : "Plan it"}
        </button>
        <p className="muted dcf-hint">
          {seen?.planWhy
            ? `${seen.planWhy} The first fills within the hour; the rest wait at support.`
            : "The desk plans an entry that fills within the hour, then limits under it at support."}
        </p>
      </form>
      {waiting.count > 0 && (
        <label className="ldr-replace">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Also re-plan its {waiting.count} waiting {waiting.count === 1 ? "limit" : "limits"} (
          {dollars(String(waiting.usd))}): they're cancelled and their money joins this plan
        </label>
      )}

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="dcf-split" aria-hidden="true">
            {rows.map((r, i) =>
              r.on && Number(r.spend) > 0 ? (
                <span
                  key={i}
                  className={`dcf-seg tone-${(i % 5) + 1}`}
                  style={{ flexGrow: Number(r.spend) }}
                >
                  <b>{i === 0 ? "Entry" : `Limit ${i}`}</b>{" "}
                  {Math.round((Number(r.spend) * 100) / Math.max(total, 1))}%
                </span>
              ) : null,
            )}
          </div>
          <div className="dcb-scroll">
            <table className="dcb-table dcf-table" aria-label={`${coin} limit buys`}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th className="r">Limit</th>
                  <th className="r">{quote}</th>
                  <th>Fill in 7 days</th>
                  <th>Why here</th>
                  <th>
                    <span className="visually-hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const s = seenOf(i);
                  const under = s ? Number(s.underPct) : null;
                  return (
                    <tr key={i}>
                      <td>
                        <b>{i === 0 ? "Entry" : `Limit ${i}`}</b>
                        {seen && <small className="dcb-id">now {limit(seen.now)}</small>}
                      </td>
                      <td className="r">
                        <input
                          className="dcb-num"
                          aria-label={`${i === 0 ? "Entry" : `Limit ${i}`} price`}
                          inputMode="decimal"
                          value={r.price}
                          disabled={!r.on}
                          onChange={(e) => edit(i, { price: e.target.value })}
                        />
                      </td>
                      <td className="r">
                        <input
                          className="dcb-num"
                          aria-label={`${i === 0 ? "Entry" : `Limit ${i}`} amount`}
                          inputMode="decimal"
                          value={r.on ? r.spend : ""}
                          placeholder="0"
                          disabled={!r.on}
                          onChange={(e) => edit(i, { spend: e.target.value })}
                        />
                      </td>
                      <td>
                        {s && (
                          <span className={`dcf-odds${s.odds < 50 ? " is-low" : ""}`}>
                            <b>{s.odds}%</b>
                            <i aria-hidden="true">
                              <span style={{ width: `${s.odds}%` }} />
                            </i>
                            <small>
                              {under !== null && under > 0
                                ? `${under.toFixed(1)}% below now`
                                : "at the price now"}
                            </small>
                          </span>
                        )}
                      </td>
                      <td className="dcf-why muted">
                        {Number(r.spend) > 0 && Number(r.spend) < MIN
                          ? `Under ${MIN} ${quote}: raise it or remove it.`
                          : r.why}
                      </td>
                      <td>
                        {rows.length > 1 && (
                          <button
                            type="button"
                            className="dpf-x"
                            aria-label={`Remove ${i === 0 ? "the entry" : `limit ${i}`}`}
                            onClick={() => reread(rows.filter((_, k) => k !== i))}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="dcb-note">
            Total {dollars(String(total))}
            {seen?.avg && <> at an average of {roundPrice(seen.avg)}</>}
            {seen && <>, likely {dollars(seen.likely)} within a week</>}. Fill in 7 days: how often,
            over the last year, the price fell that far within a week.
            {seen?.replacing && seen.replacing.length > 0 && (
              <>
                {" "}
                Replaces {seen.replacing.map((x) => roundPrice(x.price)).join(", ")} (
                {dollars(seen.freed ?? "0")}).
              </>
            )}
          </p>
          {problems.length > 0 && (
            <ul className="ldr-problems" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <div className="ldr-warns" role="status">
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <label className="ldr-anyway">
                <input
                  type="checkbox"
                  checked={anyway}
                  onChange={(e) => setAnyway(e.target.checked)}
                />
                Place anyway: I've read the warnings
              </label>
            </div>
          )}
          <div className="dcb-plan-foot">
            {agent && strategize ? (
              <AgentChat
                agent={agent}
                chips={["Best entry price?", "Key support levels", "Go deeper"]}
                ask={(message, history) =>
                  strategize({
                    message,
                    history,
                    total: amount,
                    rows: live.map((r) => ({ price: r.price, amount: r.spend, why: r.why })),
                  })
                }
                onPlan={(next) =>
                  reread(
                    next.map((r) => ({ price: r.price, spend: r.amount, why: r.why, on: true })),
                  )
                }
              />
            ) : (
              <span />
            )}
            <button
              type="button"
              className="btn btn-accent"
              disabled={
                live.length === 0 ||
                tooSmall ||
                problems.length > 0 ||
                (warnings.length > 0 && !anyway) ||
                busy !== null
              }
              onClick={go}
            >
              {busy === "place"
                ? "Placing…"
                : `${replace ? "Replace with" : "Place"} ${live.length} ${live.length === 1 ? "limit" : "limits"}`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
