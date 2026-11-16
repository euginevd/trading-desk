// dca-agent on the DCA book (TODO 11): one chat to add money, take some out, change or cancel
// open orders, or just ask. It answers in words and, when asked to act, with a card of actions
// the desk has already checked; nothing reaches Binance until the owner reviews and places it.
import { useEffect, useRef, useState } from "react";
import { agentChat, amendDcaOrder, cancelDcaOrder, placeDcaOrder } from "./api";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import OrderReview from "./OrderReview";
import { limit, two } from "./dcaFormat";
import type { DcaAction } from "./types";

type Act = DcaAction & { on: boolean; result?: string; failed?: boolean };
type Line = { who: "you" | "agent"; text: string; actions?: Act[]; said?: string[] };

const WORD: Record<DcaAction["type"], string> = {
  buy: "Buy",
  sell: "Sell",
  change: "Change",
  cancel: "Cancel",
};
const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

async function run(a: Act): Promise<string> {
  if (a.type === "cancel") return (await cancelDcaOrder(a.ref)).ref + " cancelled";
  if (a.type === "change")
    return "Now " + (await amendDcaOrder({ ref: a.ref, price: a.price, spend: a.usdc })).ref;
  const qty = String(Math.floor((Number(a.usdc) / Number(a.price)) * 1e8) / 1e8);
  const placed = await placeDcaOrder(
    a.type === "sell"
      ? { coin: a.coin, side: "sell", qty, price: a.price, source: "trim" }
      : { coin: a.coin, spend: a.usdc, price: a.price, source: "named" },
  );
  return placed.ref;
}

export default function DcaChat({
  hasOpen,
  open,
  onOpen,
  onDone,
}: {
  hasOpen: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
  }, [lines]);
  useEffect(() => {
    if (review !== null) dialog.current?.showModal?.();
  }, [review]);

  const send = (message: string) => {
    const words = message.trim();
    if (!words || busy) return;
    const history = lines.map(({ who, text: t }) => ({ who, text: t }));
    setLines((l) => [...l, { who: "you", text: words }]);
    setText("");
    setBusy(true);
    agentChat(words, history).then(
      (r) => {
        setLines((l) => [
          ...l,
          {
            who: "agent",
            text: r.reply,
            said: r.said,
            actions: r.actions.map((a) => ({ ...a, on: true })),
          },
        ]);
        setBusy(false);
      },
      (e: unknown) => {
        setLines((l) => [...l, { who: "agent", text: errorOf(e, "dca-agent didn't answer.") }]);
        setBusy(false);
      },
    );
  };

  const toggle = (at: number, i: number, on: boolean) =>
    setLines((l) =>
      l.map((line, k) =>
        k === at && line.actions
          ? { ...line, actions: line.actions.map((a, j) => (j === i ? { ...a, on } : a)) }
          : line,
      ),
    );

  const place = async () => {
    if (review === null) return;
    const line = lines[review];
    if (!line?.actions) return;
    setBusy(true);
    const next = [...line.actions];
    for (const [i, a] of next.entries()) {
      if (!a.on || a.result) continue;
      try {
        next[i] = { ...a, result: await run(a) };
      } catch (e) {
        next[i] = { ...a, result: errorOf(e, "Not done."), failed: true };
      }
      setLines((l) => l.map((x, k) => (k === review ? { ...x, actions: [...next] } : x)));
    }
    setBusy(false);
    dialog.current?.close?.();
    setReview(null);
    onDone();
  };

  const chips = [
    "Add $50",
    "Take $20 out of whatever is hottest",
    ...(hasOpen ? ["Move my open limits a little closer", "Cancel my open orders"] : []),
    "Is anything overheated right now?",
  ];
  const chosen =
    review !== null ? (lines[review]?.actions ?? []).filter((a) => a.on && !a.result) : [];

  return (
    <>
      {!open && (
        <button type="button" className="dcc-launch" onClick={() => onOpen(true)}>
          <AgentAvatar icon="dca" slug="dca-agent" />
          <span>
            <b>Ask dca-agent</b>
            <small>
              {lines.length ? "Your conversation is kept" : "Add, take out, change or cancel"}
            </small>
          </span>
        </button>
      )}
      <aside className={`dcc${open ? " is-open" : ""}`} aria-label="dca-agent" hidden={!open}>
        <header className="dcc-head">
          <AgentAvatar icon="dca" slug="dca-agent" size="lg" />
          <div>
            <b>dca-agent</b>
            <small>The patient buyer. Ask it to add, take out, change or cancel.</small>
          </div>
          <button
            type="button"
            className="dcc-fold"
            aria-label="Fold dca-agent away"
            onClick={() => onOpen(false)}
          >
            ⟩
          </button>
        </header>

        <ol className="dcc-lines" ref={list} aria-live="polite">
          {lines.length === 0 && (
            <li className="dcc-hello">
              Tell me what to do with the book, in your own words. I'll propose the orders; nothing
              is placed until you review it.
            </li>
          )}
          {lines.map((line, at) => (
            <li key={at} className={`is-${line.who}`}>
              <p>{line.text}</p>
              {line.said?.map((s) => (
                <p key={s} className="dcb-warn">
                  {s}
                </p>
              ))}
              {line.actions && line.actions.length > 0 && (
                <div className="dcc-card">
                  {line.actions.map((a, i) => (
                    <label
                      key={`${a.type}-${a.ref || a.coin}`}
                      className={a.failed ? "is-failed" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={a.on}
                        disabled={Boolean(a.result) || busy}
                        onChange={(e) => toggle(at, i, e.target.checked)}
                      />
                      <span className={`dcc-type is-${a.type}`}>{WORD[a.type]}</span>
                      <span className="dcb-coin">
                        <CoinIcon coin={a.coin} />
                        {a.coin}
                      </span>
                      <span className="num">
                        {a.type === "cancel"
                          ? `${limit(a.was)}, ${two(a.usdc)}`
                          : `${a.was ? `${limit(a.was)} → ` : ""}${limit(a.price)}, $${two(a.usdc)}`}
                      </span>
                      {a.odds && a.odds.pct !== null && (
                        <span className={`num dcc-odds${a.odds.pct < 75 ? " is-low" : ""}`}>
                          {a.odds.pct}%
                        </span>
                      )}
                      <small>{a.result ?? a.reason}</small>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="btn btn-accent btn-small"
                    disabled={busy || !line.actions.some((a) => a.on && !a.result)}
                    onClick={() => setReview(at)}
                  >
                    Review {line.actions.filter((a) => a.on && !a.result).length}
                  </button>
                </div>
              )}
            </li>
          ))}
          {busy && review === null && <li className="is-agent dcc-wait">Thinking…</li>}
        </ol>

        <div className="dcc-chips">
          {chips.map((c) => (
            <button key={c} type="button" disabled={busy} onClick={() => send(c)}>
              {c}
            </button>
          ))}
        </div>
        <form
          className="dcc-say"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add $100, mostly BTC…"
            aria-label="Message to dca-agent"
            maxLength={500}
          />
          <button type="submit" className="btn" disabled={!text.trim() || busy}>
            Send
          </button>
        </form>

        <dialog ref={dialog} aria-labelledby="dcc-confirm" onClose={() => setReview(null)}>
          <h2 id="dcc-confirm">
            Place {chosen.length} {chosen.length === 1 ? "action" : "actions"}?
          </h2>
          <OrderReview
            quote="USDC"
            items={chosen.map((a) => ({
              coin: a.coin,
              action: WORD[a.type] as "Buy" | "Sell" | "Change" | "Cancel",
              price: a.price,
              usdc: a.usdc,
              was: a.was,
              odds: a.odds?.pct ?? null,
            }))}
            note="They go to Binance now and wait for their price. A sale is a taxable event."
          />
          <div className="dlg-btns">
            <button className="btn" type="button" onClick={() => dialog.current?.close()}>
              Not yet
            </button>
            <button
              className="btn btn-accent"
              type="button"
              disabled={busy}
              onClick={() => void place()}
            >
              Place {chosen.length}
            </button>
          </div>
        </dialog>
      </aside>
    </>
  );
}
