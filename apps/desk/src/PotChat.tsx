// trading-agent beside the trading pot (docs/plan-trade.md): one chat to open a trade, move a
// stop, close or cancel, or just ask why. It answers in words and, when asked to act, with cards
// the desk has already checked; nothing reaches Binance until the owner reviews it.
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelPotTrade, closePotTrade, movePotStop, placePotTrade, potAgent } from "./api";
import { errorOf } from "./format";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import { dollars } from "./dcaFormat";
import { px } from "./PotPanel";
import type { PotAction } from "./types";

export type Act = PotAction & { on: boolean; result?: string; failed?: boolean };
export type Line = { who: "you" | "agent"; text: string; actions?: Act[]; said?: string[] };

const WORD: Record<PotAction["type"], string> = {
  open: "Open",
  stop: "Move stop",
  close: "Close",
  cancel: "Cancel",
};

// What one card does, through the same endpoints as the page.
export async function runAction(a: PotAction): Promise<string> {
  const ref = a.ref ?? "";
  if (a.type === "cancel") return `${(await cancelPotTrade(ref)).ref} cancelled`;
  if (a.type === "close") return `${(await closePotTrade(ref)).ref} closed`;
  if (a.type === "stop") return `Stop now ${px((await movePotStop(ref, a.stop ?? "")).stop)}`;
  const placed = await placePotTrade({
    coin: a.coin ?? "",
    entry: a.entry ?? "",
    stop: a.stop ?? "",
    target: a.target ?? "",
    setup: a.setup ?? "",
    reason: a.reason,
  });
  return placed.ref;
}

// The conversation, kept by the page so a proposal's Ask why can start it.
export function usePotChat() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const send = useCallback(
    (message: string) => {
      const words = message.trim();
      if (!words || busy) return;
      const history = lines.map(({ who, text }) => ({ who, text }));
      setLines((l) => [...l, { who: "you", text: words }]);
      setBusy(true);
      potAgent(words, history).then(
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
          setLines((l) => [
            ...l,
            { who: "agent", text: errorOf(e, "trading-agent didn't answer.") },
          ]);
          setBusy(false);
        },
      );
    },
    [busy, lines],
  );
  return { lines, setLines, busy, setBusy, send };
}
export type PotChatState = ReturnType<typeof usePotChat>;

function what(a: PotAction): string {
  if (a.type === "open")
    return `${px(a.entry)}, stop ${px(a.stop)}, target ${px(a.target)}, ${dollars(a.spend)}`;
  if (a.type === "stop") return `${a.ref ?? ""}: stop to ${px(a.stop)}`;
  return a.ref ?? "";
}

export default function PotChat({
  chat,
  open,
  onOpen,
  onReview,
  onDone,
}: {
  chat: PotChatState;
  open: boolean;
  onOpen: (open: boolean) => void;
  onReview: (action: PotAction) => void;
  onDone: () => void;
}) {
  const { lines, setLines, busy, setBusy, send } = chat;
  const [text, setText] = useState("");
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

  const toggle = (at: number, i: number, on: boolean) =>
    setLines((l) =>
      l.map((line, k) =>
        k === at && line.actions
          ? { ...line, actions: line.actions.map((a, j) => (j === i ? { ...a, on } : a)) }
          : line,
      ),
    );
  const chosenAt = (at: number) => (lines[at]?.actions ?? []).filter((a) => a.on && !a.result);

  // One trade to open goes through the page's review; anything else, a confirm list here.
  const startReview = (at: number) => {
    const chosen = chosenAt(at);
    if (chosen.length === 1 && chosen[0]?.type === "open") onReview(chosen[0]);
    else setReview(at);
  };

  const place = async () => {
    if (review === null) return;
    const line = lines[review];
    if (!line?.actions) return;
    setBusy(true);
    const next = [...line.actions];
    for (const [i, a] of next.entries()) {
      if (!a.on || a.result) continue;
      try {
        next[i] = { ...a, result: await runAction(a) };
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

  const chips = ["Why no trade today?", "How's the pot doing?", "Tighten my stops"];
  const chosen = review !== null ? chosenAt(review) : [];

  return (
    <>
      {!open && (
        <button type="button" className="dcc-launch" onClick={() => onOpen(true)}>
          <AgentAvatar icon="research" slug="trading-agent" />
          <span>
            <b>Ask trading-agent</b>
            <small>
              {lines.length ? "Your conversation is kept" : "Trade, move a stop, ask why"}
            </small>
          </span>
        </button>
      )}
      <aside className={`dcc${open ? " is-open" : ""}`} aria-label="trading-agent" hidden={!open}>
        <header className="dcc-head">
          <AgentAvatar icon="research" slug="trading-agent" size="lg" />
          <div>
            <b>trading-agent</b>
            <small>The disciplined trader. It proposes; you approve every order.</small>
          </div>
          <button
            type="button"
            className="dcc-fold"
            aria-label="Fold trading-agent away"
            onClick={() => onOpen(false)}
          >
            ⟩
          </button>
        </header>

        <ol className="dcc-lines" ref={list} aria-live="polite">
          {lines.length === 0 && (
            <li className="dcc-hello">
              Ask for a trade in your own words, like "buy $10 SOL at 140, stop 128", or ask why
              there's no trade today. Nothing is placed until you review it.
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
                      key={`${a.type}-${a.ref ?? a.coin ?? i}`}
                      className={a.failed ? "is-failed" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={a.on}
                        disabled={Boolean(a.result) || busy}
                        onChange={(e) => toggle(at, i, e.target.checked)}
                      />
                      <span className={`dcc-type is-${a.type === "open" ? "buy" : "sell"}`}>
                        {WORD[a.type]}
                      </span>
                      {a.coin ? (
                        <span className="dcb-coin">
                          <CoinIcon coin={a.coin} />
                          {a.coin}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="num">{what(a)}</span>
                      {a.type === "open" && a.rr && (
                        <span className="num dcc-odds">{a.rr} : 1</span>
                      )}
                      <small>
                        {a.result ??
                          (a.type === "open" && a.risk
                            ? `${dollars(a.risk)} at risk. ${a.reason}`
                            : a.reason)}
                      </small>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="btn btn-accent btn-small"
                    disabled={busy || chosenAt(at).length === 0}
                    onClick={() => startReview(at)}
                  >
                    Review {chosenAt(at).length}
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
            setText("");
          }}
        >
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Buy $10 SOL at 140, stop 128…"
            aria-label="Message to trading-agent"
            maxLength={500}
          />
          <button type="submit" className="btn" disabled={!text.trim() || busy}>
            Send
          </button>
        </form>

        <dialog ref={dialog} aria-labelledby="pot-confirm" onClose={() => setReview(null)}>
          <h2 id="pot-confirm">
            Do {chosen.length} {chosen.length === 1 ? "action" : "actions"}?
          </h2>
          <ul className="pot-rv" aria-label="Actions to do">
            {chosen.map((a, i) => (
              <li key={`${a.type}-${a.ref ?? a.coin ?? i}`}>
                <span className={`dcc-type is-${a.type === "open" ? "buy" : "sell"}`}>
                  {WORD[a.type]}
                </span>
                <span>
                  {a.coin && <b>{a.coin} </b>}
                  {what(a)}
                </span>
                <span className="num">{a.type === "open" ? dollars(a.spend) : ""}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            They go to Binance now. A stop only ever moves toward profit; closing sells at market.
          </p>
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
              Do {chosen.length}
            </button>
          </div>
        </dialog>
      </aside>
    </>
  );
}
