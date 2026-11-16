// The command bar (decision 62): ask about the plan, or change it. A change comes back as a diff
// of profile.md and is saved, as a new version, only on Accept.
import { type FormEvent, useState } from "react";
import { acceptSuggestion, askProfile, rejectSuggestion } from "./api";
import type { DiffLine, ProfilePage, ProfileSuggestion } from "./types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function DiffView({ lines, label }: { lines: DiffLine[]; label: string }) {
  return (
    <ol className="pf-diff" aria-label={label}>
      {lines.map((l, i) => (
        <li key={i} className={l.kind}>
          <span className="pf-diff-mark" aria-hidden="true">
            {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
          </span>
          <span className="visually-hidden">
            {l.kind === "add" ? "Added: " : l.kind === "del" ? "Removed: " : ""}
          </span>
          {l.text || " "}
        </li>
      ))}
    </ol>
  );
}

export default function CommandBar({
  pending,
  onSaved,
}: {
  pending: ProfileSuggestion | null;
  onSaved: (page?: ProfilePage) => void; // no page: read it again
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<{ question: string; answer: string } | null>(null);
  const [change, setChange] = useState<ProfileSuggestion | null>(null);
  const shown = change ?? (pending?.markdown ? pending : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ask = text.trim();
    if (!ask || busy) return;
    setBusy(true);
    setError("");
    setAnswer(null);
    askProfile(ask).then(
      (reply) => {
        setBusy(false);
        setText("");
        if (reply.kind === "answer") setAnswer({ question: reply.question, answer: reply.answer });
        else setChange(reply.suggestion);
      },
      (err: unknown) => {
        setBusy(false);
        setError(message(err, "That couldn't be answered. Try again."));
      },
    );
  };

  const accept = (s: ProfileSuggestion) => {
    setBusy(true);
    setError("");
    acceptSuggestion(s.id).then(
      (page) => {
        setBusy(false);
        setChange(null);
        onSaved(page);
      },
      (err: unknown) => {
        setBusy(false);
        setError(message(err, "The change couldn't be saved."));
      },
    );
  };

  const discard = (s: ProfileSuggestion) => {
    setBusy(true);
    rejectSuggestion(s.id).then(
      () => {
        setBusy(false);
        setChange(null);
        onSaved();
      },
      (err: unknown) => {
        setBusy(false);
        setError(message(err, "The change couldn't be discarded."));
      },
    );
  };

  return (
    <div className="pf-command">
      <form className="pf-command-bar" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="pf-ask">
          Ask or change your plan
        </label>
        <input
          id="pf-ask"
          type="text"
          value={text}
          maxLength={600}
          placeholder="Ask about your plan, or change a figure. Nothing changes until you accept it."
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="primary" disabled={busy || !text.trim()}>
          {busy ? "Working…" : "Ask"}
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <div className="card pf-answer" role="status">
          <p className="muted">{answer.question}</p>
          <p>{answer.answer}</p>
          <button type="button" className="pf-link" onClick={() => setAnswer(null)}>
            Close
          </button>
        </div>
      )}
      {shown && (
        <div className="card pf-change" aria-label="Proposed change">
          <div className="pf-head">
            <h2>Proposed change</h2>
            <span className="muted">{shown.summary}</span>
          </div>
          {shown.reason && <p className="muted pf-sub">Why: {shown.reason}</p>}
          <DiffView lines={shown.diff ?? []} label="Changes to profile.md" />
          <div className="pf-change-actions">
            <button type="button" className="primary" onClick={() => accept(shown)} disabled={busy}>
              Accept
            </button>
            <button type="button" onClick={() => discard(shown)} disabled={busy}>
              Discard
            </button>
            <span className="muted">Accept saves it as a new version of profile.md.</span>
          </div>
        </div>
      )}
    </div>
  );
}
