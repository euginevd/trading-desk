// The trading agent's profile (TODO 6): how the agent works, beside the owner's Profile, which
// says what's allowed. Nothing here can loosen a Profile rule. Each save is a version.
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  exportTradingAgent,
  getTradingAgent,
  getTradingAgentVersion,
  importTradingAgent,
  restoreTradingAgent,
  saveTradingAgent,
} from "./api";
import { dayOf } from "./profileFields";
import type {
  AgentAutonomy,
  AgentDoc,
  AgentFocus,
  AgentPage,
  AgentStepKey,
  AgentStyle,
  AgentVersion,
} from "./types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const BRIEF_MAX = 1000;
const LINES_MAX = 10;
const LINE_MAX = 160;

const STYLES: { value: AgentStyle; label: string; hint: string }[] = [
  { value: "careful", label: "Careful", hint: "Fewer, smaller calls" },
  { value: "balanced", label: "Balanced", hint: "Follows the plan, adds on dips" },
  { value: "opportunistic", label: "Opportunistic", hint: "Acts on stronger setups" },
];
const FOCI: { value: AgentFocus; label: string; hint: string }[] = [
  { value: "dca", label: "DCA", hint: "Accumulate to targets" },
  { value: "swing", label: "Swing", hint: "Weeks, in and out" },
  { value: "both", label: "Both", hint: "DCA first, swings on top" },
];
const AUTONOMY: { value: AgentAutonomy; label: string; hint: string }[] = [
  { value: "advise", label: "Advise", hint: "Explains; you trade" },
  { value: "propose", label: "Propose", hint: "A ready order you use, edit or dismiss" },
];

// The agent's initials for their avatar: "Jordan" is J, "Sam Lee" is SL.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? (words[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

// How many fields the draft changes from the saved agent.
function changed(saved: AgentDoc, draft: AgentDoc): number {
  const keys = Object.keys(saved) as (keyof AgentDoc)[];
  const plain = keys
    .filter((k) => k !== "steps")
    .filter((k) => JSON.stringify(saved[k]) !== JSON.stringify(draft[k])).length;
  const steps = (Object.keys(saved.steps) as AgentStepKey[]).filter(
    (k) => JSON.stringify(saved.steps[k]) !== JSON.stringify(draft.steps[k]),
  ).length;
  return plain + steps;
}

export default function AgentProfile() {
  const [page, setPage] = useState<AgentPage | null>(null);
  const [draft, setDraft] = useState<AgentDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const adopt = (next: AgentPage) => {
    setPage(next);
    setDraft(next.agent);
  };
  const fetchPage = useCallback(() => {
    getTradingAgent().then(
      (next) => {
        setPage(next);
        setDraft(next.agent);
      },
      (e: unknown) => setError(message(e, "Your trading agent couldn't be read.")),
    );
  }, []);
  useEffect(() => fetchPage(), [fetchPage]);

  if (error && !page) {
    return (
      <div className="ag-state">
        <p className="error-text" role="alert">
          {error}
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            fetchPage();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!page || !draft) {
    return (
      <div className="ag-grid" aria-busy="true">
        <div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card pf-skeleton ag-skeleton" />
          ))}
          <p className="muted">Loading your trading agent…</p>
        </div>
        <div className="card pf-skeleton ag-skeleton" />
      </div>
    );
  }

  const name = draft.name.trim() || "Your agent";
  const edits = changed(page.agent, draft);
  const set = <K extends keyof AgentDoc>(key: K, value: AgentDoc[K]) => {
    setNote(null);
    setDraft({ ...draft, [key]: value });
  };
  const setStep = (key: AgentStepKey, change: Partial<{ on: boolean; model: string }>) =>
    set("steps", { ...draft.steps, [key]: { ...draft.steps[key], ...change } });

  const save = () => {
    setSaving(true);
    setNote(null);
    saveTradingAgent(draft)
      .then((next) => {
        adopt(next);
        setNote({ ok: true, text: `Saved as v${next.version}.` });
      })
      .catch((e: unknown) => setNote({ ok: false, text: message(e, "Not saved. Try again.") }))
      .finally(() => setSaving(false));
  };

  return (
    <div className="ag-grid">
      <div>
        {note && (
          <p
            className={note.ok ? "pf-note ag-note" : "error-text ag-note"}
            role={note.ok ? "status" : "alert"}
          >
            {note.text}
          </p>
        )}
        <section className="card ag-sec" aria-label="Name and title">
          <div className="ag-persona">
            <span className="ag-ava ag-ava-lg" aria-hidden="true">
              {initials(name)}
            </span>
            <div className="ag-two">
              <label className="ag-field">
                <span>Name</span>
                <input
                  className="ag-inp"
                  value={draft.name}
                  maxLength={40}
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>
              <label className="ag-field">
                <span>Title</span>
                <input
                  className="ag-inp"
                  value={draft.title}
                  maxLength={40}
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
            </div>
          </div>
          {page.version === 0 && (
            <p className="muted ag-hint">
              Not saved yet: these are the defaults. Save to make v1, and every run is stamped with
              the version it used.
            </p>
          )}
        </section>

        <section className="card ag-sec">
          <h2>Style</h2>
          <p className="ag-sub">
            How {name} leans. Always inside your Profile&apos;s rules: no style loosens one.
          </p>
          <Options options={STYLES} value={draft.style} onPick={(v) => set("style", v)} />
          <h2 className="ag-h2-gap">Focus</h2>
          <Options options={FOCI} value={draft.focus} onPick={(v) => set("focus", v)} />
        </section>

        <section className="card ag-sec">
          <h2>
            <label htmlFor="ag-brief">Brief</label>
          </h2>
          <p className="ag-sub">
            What you want {name} to do for you, in your words. Up to 1,000 characters.
          </p>
          <textarea
            id="ag-brief"
            className="ag-inp ag-brief"
            maxLength={BRIEF_MAX}
            value={draft.brief}
            onChange={(e) => set("brief", e.target.value)}
          />
          <p className="ag-count dim">{draft.brief.length.toLocaleString("en-AU")} of 1,000</p>
        </section>

        <section className="card ag-sec ag-two">
          <Lines title="Always" lines={draft.always} onChange={(v) => set("always", v)} />
          <Lines title="Never" lines={draft.never} onChange={(v) => set("never", v)} />
        </section>

        <section className="card ag-sec">
          <h2>Steps</h2>
          <p className="ag-sub">
            What {name} does when you press Analyse. Brief, Risk and Decision always run.
          </p>
          <div className="scroll">
            <table className="ag-steps">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Who</th>
                  <th scope="col">Model</th>
                  <th scope="col">On</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Brief</td>
                  <td className="muted">code</td>
                  <td className="dim">none</td>
                  <td>
                    <Switch label="Brief on" on fixed onFlip={() => undefined} />
                  </td>
                </tr>
                {page.steps.map((s) => {
                  const step = draft.steps[s.key];
                  return (
                    <tr key={s.key}>
                      <td>{s.title}</td>
                      <td className="muted">{s.who}</td>
                      <td>
                        <select
                          className="ag-inp ag-select"
                          aria-label={`${s.title} model`}
                          value={step.model}
                          onChange={(e) => setStep(s.key, { model: e.target.value })}
                        >
                          {page.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        {s.key === "macro" && <span className="dim"> · 3 searches</span>}
                      </td>
                      <td>
                        <Switch
                          label={`${s.title} on`}
                          on={s.fixed || step.on}
                          fixed={s.fixed}
                          onFlip={() => setStep(s.key, { on: !step.on })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ag-row">
            <label htmlFor="ag-floor">
              Confidence floor: below it, {name} says Wait with no order
            </label>
            <b className="num">{draft.confidenceFloor}%</b>
          </div>
          <input
            id="ag-floor"
            className="ag-range"
            type="range"
            min={0}
            max={90}
            step={5}
            value={draft.confidenceFloor}
            onChange={(e) => set("confidenceFloor", Number(e.target.value))}
          />
          <div className="ag-row">
            <span className="muted">Estimated cost a run</span>
            <b className="num">about ${page.estimate}</b>
          </div>
        </section>

        <section className="card ag-sec">
          <h2>Autonomy</h2>
          <p className="ag-sub">How far {name} goes on their own.</p>
          <Options
            options={AUTONOMY}
            value={draft.autonomy}
            onPick={(v) => set("autonomy", v)}
            locked={{ label: "Auto within limits", hint: "Needs its own decision (spec 10)" }}
          />
        </section>

        <div className="ag-save">
          <span className="dim">
            {edits === 0 ? "No changes" : edits === 1 ? "1 change" : `${edits} changes`}
          </span>
          <button
            type="button"
            disabled={edits === 0 || saving}
            onClick={() => {
              setDraft(page.agent);
              setNote(null);
            }}
          >
            Discard
          </button>
          <button type="button" className="primary" disabled={edits === 0 || saving} onClick={save}>
            {saving ? "Saving…" : `Save as v${page.version + 1}`}
          </button>
        </div>
      </div>

      <aside>
        <Versions page={page} onPage={adopt} onNote={setNote} />
        <section className="card ag-sec">
          <h2>What {page.agent.name || "your agent"} is told</h2>
          <p className="ag-sub">
            Made from the saved fields. The fixed part stays in code.
            {edits > 0 && " Save to see your changes here."}
          </p>
          <pre className="ag-told">{page.told}</pre>
        </section>
      </aside>
    </div>
  );
}

function Options<T extends string>({
  options,
  value,
  onPick,
  locked,
}: {
  options: { value: T; label: string; hint: string }[];
  value: T;
  onPick: (value: T) => void;
  locked?: { label: string; hint: string };
}) {
  return (
    <div className="ag-opts">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`ag-opt${o.value === value ? " on" : ""}`}
          aria-pressed={o.value === value}
          onClick={() => onPick(o.value)}
        >
          {o.label}
          <small>{o.hint}</small>
        </button>
      ))}
      {locked && (
        <button type="button" className="ag-opt" disabled aria-pressed={false}>
          {locked.label}
          <small>{locked.hint}</small>
        </button>
      )}
    </div>
  );
}

function Switch({
  label,
  on,
  fixed = false,
  onFlip,
}: {
  label: string;
  on: boolean;
  fixed?: boolean;
  onFlip: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={fixed ? "Always runs" : undefined}
      className={`toggle${on ? " on" : ""}`}
      disabled={fixed}
      onClick={onFlip}
    />
  );
}

function Lines({
  title,
  lines,
  onChange,
}: {
  title: string;
  lines: string[];
  onChange: (lines: string[]) => void;
}) {
  const [typed, setTyped] = useState("");
  const full = lines.length >= LINES_MAX;
  const add = (e: FormEvent) => {
    e.preventDefault();
    const line = typed.trim();
    if (!line || full) return;
    onChange([...lines, line]);
    setTyped("");
  };
  return (
    <div>
      <h2>{title}</h2>
      <p className="ag-sub">Up to 10.</p>
      {lines.length === 0 ? (
        <p className="dim ag-none">None yet.</p>
      ) : (
        <ul className="ag-lst">
          {lines.map((line, i) => (
            <li key={`${i}-${line}`}>
              <span>{line}</span>
              <button
                type="button"
                className="pf-link ag-rm"
                aria-label={`Remove “${line}” from ${title}`}
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="ag-add" onSubmit={add}>
        <input
          className="ag-inp"
          aria-label={`Add a line to ${title}`}
          placeholder={full ? "That's 10: remove one first" : "Add a line"}
          maxLength={LINE_MAX}
          disabled={full}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" disabled={full || !typed.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

function Versions({
  page,
  onPage,
  onNote,
}: {
  page: AgentPage;
  onPage: (page: AgentPage) => void;
  onNote: (note: { ok: boolean; text: string }) => void;
}) {
  const older = page.history.filter((h) => h.n !== page.version);
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = picked ?? older[0]?.n ?? null;
  const [compared, setCompared] = useState<AgentVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const work = (pending: Promise<void>) => {
    setBusy(true);
    pending.finally(() => setBusy(false));
  };
  const compare = (n: number) =>
    work(
      getTradingAgentVersion(n).then(setCompared, (e: unknown) =>
        onNote({ ok: false, text: message(e, "That version couldn't be read.") }),
      ),
    );
  const restore = (n: number) =>
    work(
      restoreTradingAgent(n).then(
        (next) => {
          setCompared(null);
          setPicked(null);
          onPage(next);
          onNote({ ok: true, text: `v${n} restored as v${next.version}.` });
        },
        (e: unknown) => onNote({ ok: false, text: message(e, "Not restored. Try again.") }),
      ),
    );
  const download = () =>
    exportTradingAgent().then(
      (r) => {
        const url = URL.createObjectURL(new Blob([r.markdown], { type: "text/markdown" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "agent.md";
        link.click();
        URL.revokeObjectURL(url);
      },
      (e: unknown) => onNote({ ok: false, text: message(e, "Not exported. Try again.") }),
    );

  return (
    <section className="card ag-sec" aria-label="Versions">
      <h2>Versions</h2>
      <p className="ag-sub">Each save is a version. Every run is stamped with the one it used.</p>
      {page.history.length === 0 ? (
        <p className="muted">Not saved yet. Save to make v1.</p>
      ) : (
        <ul className="ag-vers">
          {page.history.map((h) => {
            const current = h.n === page.version;
            return (
              <li key={h.n}>
                <button
                  type="button"
                  className={`ag-ver${chosen === h.n && !current ? " on" : ""}`}
                  aria-pressed={!current && chosen === h.n}
                  disabled={current}
                  onClick={() => {
                    setPicked(h.n);
                    setCompared(null);
                  }}
                >
                  <b>
                    v{h.n}
                    {current && " · current"}
                  </b>
                  <span className="muted">
                    {dayOf(h.time)} · {h.summary}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="ag-actions">
        {chosen !== null && (
          <>
            <button type="button" disabled={busy} onClick={() => compare(chosen)}>
              Compare
            </button>
            <button type="button" disabled={busy} onClick={() => restore(chosen)}>
              Restore v{chosen}
            </button>
          </>
        )}
        <button type="button" onClick={download} disabled={page.version === 0}>
          Export agent.md
        </button>
        <input
          ref={file}
          type="file"
          accept=".md,text/markdown,text/plain"
          className="visually-hidden"
          aria-label="Import agent.md"
          tabIndex={-1}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (!picked) return;
            picked
              .text()
              .then(importTradingAgent)
              .then((next) => {
                onPage(next);
                onNote({ ok: true, text: `Imported as v${next.version}.` });
              })
              .catch((err: unknown) => onNote({ ok: false, text: message(err, "Not imported.") }));
          }}
        />
        <button type="button" onClick={() => file.current?.click()}>
          Import agent.md
        </button>
      </div>
      {compared && (
        <div className="ag-compare" aria-label={`v${compared.n} against the current version`}>
          <h3>
            v{compared.n} against v{page.version}
          </h3>
          {compared.changes.length === 0 ? (
            <p className="muted">No differences.</p>
          ) : (
            <table className="pf-table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">v{compared.n}</th>
                  <th scope="col">Now</th>
                </tr>
              </thead>
              <tbody>
                {compared.changes.map((c) => (
                  <tr key={c.label}>
                    <td className="muted">{c.label}</td>
                    <td className="pf-pre">{c.from}</td>
                    <td className="pf-pre pf-new">{c.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
