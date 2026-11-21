// Strategize with the agent (owner, 21 Nov 2026), in Add funds and Take profit on both pages:
// three quick questions or your own words; each answer comes with the whole plan, which the
// panel puts in its table for you to check and place. The agent never places an order.
import { useState } from "react";
import { errorOf } from "./format";
import type { StrategizeReply } from "./types";

type Line = { who: "you" | "agent"; text: string };

export default function AgentChat({
  agent,
  chips,
  ask,
  onPlan,
}: {
  agent: string; // "trading-agent"
  chips: [string, string, string];
  ask: (message: string, history: Line[]) => Promise<StrategizeReply>;
  onPlan: (rows: StrategizeReply["rows"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = (text: string) => {
    const said = text.trim();
    if (!said || busy) return;
    const history = lines;
    setLines([...history, { who: "you", text: said }]);
    setMessage("");
    setBusy(true);
    setError(null);
    ask(said, history).then(
      (r) => {
        setBusy(false);
        setLines((l) => [...l, { who: "agent", text: r.reply }]);
        if (r.rows.length) onPlan(r.rows);
      },
      (e: unknown) => {
        setBusy(false);
        setError(errorOf(e, `${agent} couldn't be reached.`));
      },
    );
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-small ach-open" onClick={() => setOpen(true)}>
        <span aria-hidden="true">✦</span> Strategize with {agent}
      </button>
    );
  }
  return (
    <div className="dcf-chat ach" aria-label={`Talk to ${agent}`}>
      <div className="ach-chips">
        {chips.map((c) => (
          <button key={c} type="button" className="chip" disabled={busy} onClick={() => send(c)}>
            {c}
          </button>
        ))}
      </div>
      {lines.length > 0 && (
        <ol className="dcf-lines" aria-live="polite">
          {lines.map((l, i) => (
            <li key={i} className={`is-${l.who}`}>
              {l.text}
            </li>
          ))}
          {busy && <li className="is-agent muted">Thinking…</li>}
        </ol>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <form
        className="dcf-say"
        onSubmit={(e) => {
          e.preventDefault();
          send(message);
        }}
      >
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Change an amount or price, or ask why…"
          aria-label={`Ask ${agent}`}
          maxLength={500}
        />
        <button type="submit" className="btn" disabled={!message.trim() || busy}>
          {busy ? "Thinking…" : "Send"}
        </button>
      </form>
    </div>
  );
}
