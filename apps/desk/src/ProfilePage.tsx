// The Profile (decision 58): the owner's Investment Policy Statement, written when calm to hold
// them to their plan when they're not. Every agent reads it. Each save is a version.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptSuggestion,
  askProfile,
  exportProfile,
  getProfilePage,
  importProfile,
  rejectSuggestion,
  restoreProfile,
  saveProfileSection,
} from "./api";
import { audText, dayOf, dayText, SECTIONS } from "./profileFields";
import { Card, CheckTag, Editor, SectionView, SuggestionDiff } from "./ProfileCards";
import { AllocationReview, HistoryDrawer, Scorecard, WhatIf } from "./ProfileTools";
import type { CommandReply, ProfileDoc, ProfilePage as Page, ProfileSection } from "./types";
import "./profile.css";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const WIDE: ProfileSection[] = ["strategy", "rules", "holdings", "additional_info"];
const LOCKS: Partial<Record<ProfileSection, { key: keyof ProfileDoc["locks"]; label: string }[]>> =
  {
    goals: [{ key: "goals", label: "Goals" }],
    foundations: [{ key: "min_cash", label: "Minimum cash" }],
    rules: [{ key: "deposit_cap", label: "Deposit cap" }],
  };
const CHIPS: { label: string; fill?: string; ask?: string; edit?: ProfileSection }[] = [
  { label: "Update holdings", edit: "holdings" },
  { label: "Log a lesson", fill: "Add a lesson: " },
  {
    label: "Review my rules",
    ask: "Which of my rules am I breaking, and do any clash with my goals?",
  },
  { label: "Monthly check-in", ask: "Monthly check-in: how did this month go against my Profile?" },
];

export default function ProfilePage() {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    section: ProfileSection;
    value?: unknown;
    from?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchPage = useCallback(() => {
    getProfilePage().then(setPage, (e: unknown) =>
      setError(message(e, "Your Profile couldn't be read.")),
    );
  }, []);
  useEffect(() => fetchPage(), [fetchPage]);
  const load = () => {
    setError(null);
    fetchPage();
  };

  if (error && !page) {
    return (
      <main className="wrap pf-page">
        <p className="error-text" role="alert">
          {error}
        </p>
        <button type="button" onClick={load}>
          Try again
        </button>
      </main>
    );
  }
  if (!page) {
    return (
      <main className="wrap pf-page" aria-busy="true">
        <div className="pf-title">
          <h1>Profile</h1>
        </div>
        <div className="pf-strip">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card pf-skeleton" />
          ))}
        </div>
        <p className="muted">Loading your Profile…</p>
      </main>
    );
  }

  const save = (
    section: ProfileSection | "locks",
    value: unknown,
    reason: string,
    from?: string,
  ) => {
    setSaving(true);
    setSaveError(null);
    saveProfileSection(section, value as never, reason)
      .then(async (next) => {
        if (from) await rejectSuggestion(from).catch(() => undefined); // edited: the owner's own now
        setPage(from ? await getProfilePage() : next);
        setEditing(null);
        setNote({ ok: true, text: `Saved as v${next.version}.` });
      })
      .catch((e: unknown) => setSaveError(message(e, "Not saved. Try again.")))
      .finally(() => setSaving(false));
  };
  const act = (work: Promise<unknown>, done: string) => {
    setBusy(true);
    setNote(null);
    work
      .then(() => getProfilePage())
      .then((next) => {
        setPage(next);
        setNote({ ok: true, text: done });
      })
      .catch((e: unknown) =>
        setNote({ ok: false, text: message(e, "That didn't work. Try again.") }),
      )
      .finally(() => setBusy(false));
  };
  const restore = (n: number) =>
    restoreProfile(n).then(
      (next) => {
        setPage(next);
        setNote({ ok: true, text: `v${n} restored as v${next.version}.` });
      },
      (e: unknown) => setNote({ ok: false, text: message(e, "Not restored. Try again.") }),
    );

  const doc = page.profile;
  const touching = (section: ProfileSection) =>
    page.suggestions.filter((s) => s.changes.some((c) => c.section === section));

  return (
    <main className="wrap pf-page">
      <div className="pf-title">
        <h1>Profile</h1>
        <button
          type="button"
          className="pf-version"
          onClick={() => setHistory(!history)}
          aria-expanded={history}
          aria-label={`Version history, now v${page.version}`}
        >
          {page.version && page.time ? `v${page.version} · ${dayOf(page.time)}` : "No versions yet"}
        </button>
        <span className="pf-spacer" />
        <button type="button" disabled title="Coming later">
          Set up with wizard
        </button>
        <ImportExport onImported={(next) => setPage(next)} onNote={setNote} />
      </div>
      <p className="muted pf-intro">
        Your Investment Policy Statement: who you are, your money, goals and rules. Every agent
        reads it before advising you, and a rule you haven't set is never enforced.
      </p>
      {note && (
        <p className={note.ok ? "pf-note" : "error-text"} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      )}
      {page.version === 0 && (
        <div className="card pf-empty">
          <p>No profile yet. Import your profile.md, or fill in each card with its pencil.</p>
        </div>
      )}

      <Strip page={page} />
      <CommandBar
        onChange={(next) => setPage(next)}
        onEdit={(section) => setEditing({ section })}
      />

      {history && (
        <HistoryDrawer
          current={page.version}
          onClose={() => setHistory(false)}
          onRestore={restore}
        />
      )}

      <div className="pf-grid">
        {SECTIONS.map((section) => {
          const pending = touching(section);
          const locks = LOCKS[section] ?? [];
          const open = editing?.section === section;
          return (
            <Card
              key={section}
              section={section}
              updated={page.updated[section]}
              badge={pending.length}
              wide={WIDE.includes(section)}
              onEdit={open ? undefined : () => setEditing({ section })}
              lock={locks.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={`pf-lock${doc.locks[l.key] ? " on" : ""}`}
                  aria-pressed={doc.locks[l.key]}
                  disabled={saving}
                  title={
                    doc.locks[l.key]
                      ? "Agents can't propose changes. Click to unlock."
                      : "Click to lock against agents' changes."
                  }
                  onClick={() => save("locks", { ...doc.locks, [l.key]: !doc.locks[l.key] }, "")}
                >
                  <span aria-hidden="true">{doc.locks[l.key] ? "●" : "○"}</span> {l.label}{" "}
                  {doc.locks[l.key] ? "locked" : "unlocked"}
                </button>
              ))}
            >
              {open ? (
                <Editor
                  section={section}
                  value={editing.value ?? doc[section]}
                  saving={saving}
                  error={saveError}
                  onSave={(value, reason) => save(section, value, reason, editing.from)}
                  onCancel={() => {
                    setEditing(null);
                    setSaveError(null);
                  }}
                />
              ) : (
                <SectionView section={section} page={page} />
              )}
              {section === "rules" && !open && <Scorecard version={page.version} />}
              {!open &&
                pending.map((s) => (
                  <SuggestionDiff
                    key={s.id}
                    suggestion={s}
                    section={section}
                    busy={busy}
                    onAccept={(reason) =>
                      act(acceptSuggestion(s.id, reason), "Accepted as a new version.")
                    }
                    onReject={() => act(rejectSuggestion(s.id), "Rejected: nothing changed.")}
                    onEdit={() =>
                      setEditing({
                        section,
                        value: s.sections[section] ?? doc[section],
                        from: s.id,
                      })
                    }
                  />
                ))}
            </Card>
          );
        })}
      </div>

      <AllocationReview review={page.planner} onDone={load} />
      <WhatIf page={page} />
    </main>
  );
}

function Strip({ page }: { page: Page }) {
  const s = page.live.strip;
  const goal = s.nextGoal;
  return (
    <section className="pf-strip" aria-label="Where you stand">
      <div className="card pf-tile">
        <span className="muted">Total now</span>
        <span className="pf-big">{audText(s.totalAud)}</span>
        <span className="muted">{audText(s.totalUsd, "USD")}</span>
      </div>
      <div className="card pf-tile">
        <span className="muted">
          {goal
            ? `Next goal · ${audText(goal.amount, goal.currency)}${goal.date ? ` by ${dayText(goal.date)}` : ""}`
            : "Next goal"}
        </span>
        <span className="pf-big">{goal ? `${goal.pct}%` : "Not set"}</span>
        {goal && <Meter pct={Number(goal.pct)} label="Progress to the next goal" tone="ok" />}
      </div>
      <div className="card pf-tile">
        <span className="muted">Cash floor</span>
        <span className={`pf-big ${s.cash.status === "attention" ? "warn" : ""}`}>
          {s.cash.floor ? `${audText(s.cash.now)} / ${audText(s.cash.floor)}` : "Not set"}
        </span>
        {s.cash.pct && (
          <Meter
            pct={Number(s.cash.pct)}
            label="Cash against the floor"
            tone={s.cash.status === "ok" ? "ok" : "warn"}
          />
        )}
        {s.cash.status === "attention" && <CheckTag status="attention" text="Below the floor" />}
      </div>
      <div className="card pf-tile">
        <span className="muted">Bought this month</span>
        <span className={`pf-big ${s.month.status === "broken" ? "bad" : ""}`}>
          {s.month.cap
            ? `${audText(s.month.spent)} / ${audText(s.month.cap)}`
            : audText(s.month.spent)}
        </span>
        {s.month.pct && (
          <Meter
            pct={Number(s.month.pct)}
            label="This month's buys against the cap"
            tone={
              s.month.status === "broken" ? "bad" : s.month.status === "attention" ? "warn" : "ok"
            }
          />
        )}
        {!s.month.cap && <span className="pf-hint">No monthly cap set</span>}
        {s.month.status === "broken" && <CheckTag status="broken" text="Over the cap" />}
      </div>
    </section>
  );
}

function Meter({ pct, label, tone }: { pct: number; label: string; tone: string }) {
  const shown = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`pf-meter ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(shown)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${shown}%` }} />
    </div>
  );
}

function CommandBar({
  onChange,
  onEdit,
}: {
  onChange: (page: Page) => void;
  onEdit: (section: ProfileSection) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<CommandReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const send = (asked: string) => {
    if (!asked.trim()) return;
    setBusy(true);
    setError(null);
    setReply(null);
    askProfile(asked)
      .then(async (r) => {
        setReply(r);
        setText("");
        if (r.kind === "change") {
          onChange(await getProfilePage());
          const first = r.suggestion.changes[0]?.section;
          if (first)
            document.getElementById(`pf-card-${first}`)?.scrollIntoView?.({ block: "center" });
        }
      })
      .catch((e: unknown) => setError(message(e, "No answer came back. Try again.")))
      .finally(() => setBusy(false));
  };

  return (
    <section className="pf-command" aria-label="Command bar">
      <form
        className="pf-command-bar"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label htmlFor="pf-command" className="visually-hidden">
          Ask or change your profile
        </label>
        <input
          id="pf-command"
          ref={input}
          value={text}
          placeholder="Ask or change your profile…"
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="primary" disabled={busy || !text.trim()}>
          {busy ? "Thinking…" : "Send"}
        </button>
      </form>
      <div className="pf-chips">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            className="pf-chip-btn"
            disabled={busy}
            onClick={() => {
              if (c.edit) onEdit(c.edit);
              else if (c.ask) send(c.ask);
              else {
                setText(c.fill ?? "");
                input.current?.focus();
              }
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {reply?.kind === "answer" && (
        <div className="pf-answer" role="status">
          <p className="muted">{reply.question}</p>
          <p className="pf-prose">{reply.answer}</p>
          <p className="pf-hint">
            AI answer from Profile v{reply.profileVersion}, advice only. Nothing was changed.{" "}
            <button type="button" className="pf-link" onClick={() => setReply(null)}>
              Dismiss
            </button>
          </p>
        </div>
      )}
      {reply?.kind === "change" && (
        <p className="pf-note" role="status">
          Proposed: {reply.suggestion.summary}. It's on the card below to accept, edit or reject.
        </p>
      )}
    </section>
  );
}

function ImportExport({
  onImported,
  onNote,
}: {
  onImported: (page: Page) => void;
  onNote: (note: { ok: boolean; text: string }) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const download = () =>
    exportProfile().then(
      (r) => {
        const url = URL.createObjectURL(new Blob([r.markdown], { type: "text/markdown" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "profile.md";
        link.click();
        URL.revokeObjectURL(url);
      },
      (e: unknown) => onNote({ ok: false, text: message(e, "Not exported. Try again.") }),
    );
  return (
    <>
      <input
        ref={file}
        type="file"
        accept=".md,text/markdown,text/plain"
        className="visually-hidden"
        aria-label="Import profile.md"
        tabIndex={-1}
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = "";
          if (!chosen) return;
          chosen
            .text()
            .then(importProfile)
            .then((next) => {
              onImported(next);
              onNote({ ok: true, text: `Imported as v${next.version}.` });
            })
            .catch((err: unknown) => onNote({ ok: false, text: message(err, "Not imported.") }));
        }}
      />
      <button type="button" onClick={() => file.current?.click()}>
        Import .md
      </button>
      <button type="button" onClick={download}>
        Export .md
      </button>
    </>
  );
}
