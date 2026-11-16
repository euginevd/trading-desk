// Open orders on the DCA book (TODO 11): ask dca-agent to change them ("move BTC a bit lower"),
// or change a price by hand. Each change cancels the old order and places a new one linked to it,
// so the book keeps both. The desk works out each new price's 24-hour odds.
import { useRef, useState } from "react";
import { amendDcaOrder, askOpenOrders, fundsOdds } from "./api";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import { limit, two } from "./dcaFormat";
import type { DcaOrder, OpenChange } from "./types";

type Change = OpenChange & { on: boolean; result?: string; failed?: boolean };
type Line = { who: "you" | "agent"; text: string };

const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function DcaOpen({
  orders,
  quote,
  onChanged,
}: {
  orders: DcaOrder[];
  quote: string;
  onChanged: (said: string) => void;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"ask" | "apply" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const chosen = changes.filter((c) => c.on && !c.result);

  const ask = () => {
    const text = message.trim();
    if (!text) return;
    setBusy("ask");
    const history = lines;
    setLines([...history, { who: "you", text }]);
    setMessage("");
    askOpenOrders(text, history).then(
      (r) => {
        setChanges(r.changes.map((c) => ({ ...c, on: true })));
        setLines((l) => [...l, { who: "agent", text: r.reply }]);
        setBusy(null);
      },
      (e: unknown) => {
        setLines((l) => [...l, { who: "agent", text: errorOf(e, "That didn't reach dca-agent.") }]);
        setBusy(null);
      },
    );
  };

  // By hand: every open order as a change, at its own price, to edit.
  const byHand = () =>
    setChanges(
      orders.map((o) => ({
        ref: o.ref,
        coin: o.coin,
        side: o.side,
        was: o.price ?? "",
        price: o.price ?? "",
        usdc: o.spend ?? "",
        now: "",
        odds: { hit: 0, windows: 0, pct: null },
        reason: "Changed by hand.",
        on: false,
      })),
    );
  const edit = (i: number, change: Partial<Change>) =>
    setChanges((all) => all.map((c, k) => (k === i ? { ...c, ...change } : c)));
  const reOdds = (i: number) => {
    const c = changes[i];
    if (!c || !(Number(c.price) > 0)) return;
    fundsOdds(c.coin, c.price, c.side === "sell" ? "remove" : "add").then(
      (o) => edit(i, { odds: o, now: o.now }),
      () => undefined,
    );
  };

  const apply = async () => {
    setBusy("apply");
    const next = [...changes];
    for (const [i, c] of next.entries()) {
      if (!c.on || c.result) continue;
      try {
        const placed = await amendDcaOrder({ ref: c.ref, price: c.price, spend: c.usdc });
        next[i] = { ...c, result: `Now ${placed.ref}` };
      } catch (e) {
        next[i] = { ...c, result: errorOf(e, "Not changed."), failed: true };
      }
      setChanges([...next]);
    }
    setBusy(null);
    dialog.current?.close?.();
    const done = next.filter((c) => c.result && !c.failed).length;
    if (done) onChanged(`${done} open ${done === 1 ? "order" : "orders"} changed.`);
  };

  return (
    <section className="dcb-section dco" aria-labelledby="dco-title">
      <div className="dcb-section-head">
        <h2 id="dco-title">Open orders</h2>
        <span className="muted">
          {orders.length} waiting for their price,{" "}
          {two(orders.reduce((s, o) => s + Number(o.spend ?? 0), 0))} {quote}
        </span>
      </div>
      <ul className="dco-list">
        {orders.map((o) => (
          <li key={o.ref}>
            <span className="dcb-coin">
              <CoinIcon coin={o.coin} />
              {o.coin}
            </span>
            <span className="num">
              {o.side === "sell" ? "Sell" : "Buy"} at {limit(o.price)}
            </span>
            <span className="num muted">{two(o.spend)}</span>
            <small className="dcb-id">{o.ref}</small>
          </li>
        ))}
      </ul>

      <form
        className="dcf-say dco-ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <AgentAvatar icon="dca" slug="dca-agent" />
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask dca-agent to change them: move BTC a bit lower, give SOL better odds…"
          aria-label="Ask dca-agent to change open orders"
          maxLength={500}
        />
        <button type="submit" className="btn" disabled={!message.trim() || busy !== null}>
          {busy === "ask" ? "Thinking…" : "Ask"}
        </button>
        <button type="button" className="link" onClick={byHand}>
          Change by hand
        </button>
      </form>
      {lines.length > 0 && (
        <ol className="dcf-lines" aria-live="polite">
          {lines.map((l, i) => (
            <li key={i} className={`is-${l.who}`}>
              {l.text}
            </li>
          ))}
        </ol>
      )}

      {changes.length > 0 && (
        <>
          <div className="dcb-scroll">
            <table className="dcb-table dcf-table" aria-label="Changes to open orders">
              <thead>
                <tr>
                  <th>
                    <span className="visually-hidden">Change</span>
                  </th>
                  <th>Order</th>
                  <th className="r">Was</th>
                  <th className="r">New limit</th>
                  <th className="r">{quote}</th>
                  <th>Likely to fill in 24h</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={c.ref}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Change ${c.ref}`}
                        checked={c.on}
                        disabled={Boolean(c.result)}
                        onChange={(e) => edit(i, { on: e.target.checked })}
                      />
                    </td>
                    <td>
                      <span className="dcb-coin">
                        <CoinIcon coin={c.coin} />
                        {c.coin}
                      </span>
                      <small className="dcb-id">{c.ref}</small>
                    </td>
                    <td className="r num muted">{limit(c.was)}</td>
                    <td className="r">
                      <input
                        className="dcb-num"
                        aria-label={`${c.ref} new limit`}
                        inputMode="decimal"
                        value={c.price}
                        disabled={Boolean(c.result)}
                        onChange={(e) => edit(i, { price: e.target.value, on: true })}
                        onBlur={() => reOdds(i)}
                      />
                    </td>
                    <td className="r">
                      <input
                        className="dcb-num"
                        aria-label={`${c.ref} amount`}
                        inputMode="decimal"
                        value={c.usdc}
                        disabled={Boolean(c.result)}
                        onChange={(e) => edit(i, { usdc: e.target.value, on: true })}
                      />
                    </td>
                    <td className="num">
                      {c.odds.pct === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <b className={c.odds.pct < 75 ? "wait" : ""}>{c.odds.pct}%</b>
                      )}
                    </td>
                    <td className={`dcf-why ${c.failed ? "error-text" : ""}`}>
                      {c.result ?? c.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dcf-foot">
            <button
              type="button"
              className="btn btn-accent"
              disabled={chosen.length === 0 || busy !== null}
              onClick={() => dialog.current?.showModal?.()}
            >
              Review {chosen.length} {chosen.length === 1 ? "change" : "changes"}
            </button>
          </div>
        </>
      )}

      <dialog ref={dialog} aria-labelledby="dco-confirm">
        <h2 id="dco-confirm">
          Change {chosen.length} open {chosen.length === 1 ? "order" : "orders"}?
        </h2>
        <p>
          {chosen.map((c) => `${c.coin} ${limit(c.was)} → ${limit(c.price)}`).join("; ")}. Each old
          order is cancelled on Binance and a new one placed, linked to it in the book; anything
          already filled stays.
        </p>
        <div className="dlg-btns">
          <button className="btn" type="button" onClick={() => dialog.current?.close()}>
            Keep them
          </button>
          <button
            className="btn btn-accent"
            type="button"
            disabled={busy !== null}
            onClick={() => void apply()}
          >
            Change {chosen.length}
          </button>
        </div>
      </dialog>
    </section>
  );
}
