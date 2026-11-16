// The Profile (decisions 58 and 61): the owner's Investment Policy Statement and their trading
// agent, each a Markdown file in local/ that the owner changes by asking Claude Code. The desk only
// reads them: it shows where they stand, and opens each file in a reader.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getProfileFile, getProfilePage, getProfileVersions } from "./api";
import AgentProfile from "./AgentProfile";
import { dateTime } from "./format";
import { Reader, useMarkdownFile, FileNote } from "./Markdown";
import { audText, dayOf, dayText } from "./profileFields";
import type { CheckStatus, ProfilePage as Page, ProfileVersion } from "./types";
import "./profile.css";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type Tab = "policy" | "agent";
const TABS: { tab: Tab; label: string }[] = [
  { tab: "policy", label: "My policy" },
  { tab: "agent", label: "Trading agent" },
];

// Two tabs: the owner's policy, and the trading agent who works inside it (#/profile?tab=agent).
export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>(() =>
    window.location.hash.includes("tab=agent") ? "agent" : "policy",
  );
  return (
    <main className="wrap pf-page">
      <h1 className="pf-h1">Profile</h1>
      <div className="tabs pf-tabs" role="tablist" aria-label="Profile">
        {TABS.map((t) => (
          <button
            key={t.tab}
            id={`pf-tab-${t.tab}`}
            type="button"
            role="tab"
            aria-selected={tab === t.tab}
            aria-controls="pf-tabpanel"
            onClick={() => setTab(t.tab)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="pf-tabpanel" className="pf-page" role="tabpanel" aria-labelledby={`pf-tab-${tab}`}>
        {tab === "policy" ? <Policy /> : <AgentProfile />}
      </div>
    </main>
  );
}

function Policy() {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const doc = useMarkdownFile(getProfileFile);

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
      <>
        <p className="error-text" role="alert">
          {error}
        </p>
        <button type="button" onClick={load}>
          Try again
        </button>
      </>
    );
  }
  if (!page) {
    return (
      <div className="pf-page" aria-busy="true">
        <div className="pf-strip">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card pf-skeleton" />
          ))}
        </div>
        <p className="muted">Loading your Profile…</p>
      </div>
    );
  }

  const stamp = page.version && page.time ? `v${page.version} · ${dayOf(page.time)}` : null;
  return (
    <>
      <div className="pf-title">
        {stamp ? (
          <button
            type="button"
            className="pf-version"
            onClick={() => setHistory(!history)}
            aria-expanded={history}
            aria-label={`Version history, now v${page.version}`}
          >
            {stamp}
          </button>
        ) : (
          <span className="muted">No versions yet</span>
        )}
        <span className="pf-spacer" />
        <button type="button" className="primary" onClick={() => doc.setOpen(true)}>
          Show Profile
        </button>
      </div>
      <FileNote name="profile.md" file={doc.file} version={page.version} />
      {history && <History current={page.version} onClose={() => setHistory(false)} />}
      {!page.live.known && (
        <p className="pf-live-off" role="alert">
          Live figures couldn't be read, so totals and checks that need Binance or the wallet show
          —.{" "}
          <button type="button" className="pf-link" onClick={load}>
            Try again
          </button>
        </p>
      )}
      <Strip page={page} />
      {doc.open && (
        <Reader
          title="Profile"
          meta={`${stamp ?? "Not saved yet"} · read-only`}
          markdown={doc.file?.markdown ?? null}
          error={doc.error}
          fileName="profile.md"
          onClose={() => doc.setOpen(false)}
          onRetry={doc.retry}
        />
      )}
    </>
  );
}

// Every version of profile.md the desk has read, newest first. Read only.
function History({ current, onClose }: { current: number; onClose: () => void }) {
  const [versions, setVersions] = useState<ProfileVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchVersions = useCallback(() => {
    getProfileVersions().then(
      (r) => setVersions(r.versions),
      (e: unknown) => setError(message(e, "The history couldn't be read.")),
    );
  }, []);
  useEffect(() => fetchVersions(), [fetchVersions, current]);
  return (
    <aside className="pf-drawer card" aria-label="Version history">
      <div className="pf-head">
        <h2>History</h2>
        <button type="button" className="pf-pencil" onClick={onClose} aria-label="Close history">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setError(null);
              fetchVersions();
            }}
          >
            Try again
          </button>
        </p>
      )}
      {!versions && !error && <p className="muted">Loading the history…</p>}
      {versions?.length === 0 && <p className="muted">No versions yet.</p>}
      {versions && versions.length > 0 && (
        <ol className="pf-versions">
          {versions.map((v) => (
            <li key={v.n}>
              <strong>
                v{v.n}
                {v.n === current && " · current"}
              </strong>
              <span className="muted">{dateTime(v.time)}</span>
              <span>{v.author}</span>
              <span>
                {v.summary}
                {v.reason && <span className="muted"> · “{v.reason}”</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

// Status is a word and a mark, never colour alone (code-standards 26).
const CHECK: Record<CheckStatus, { mark: string; tone: string }> = {
  ok: { mark: "✓", tone: "ok" },
  attention: { mark: "▲", tone: "warn" },
  broken: { mark: "✕", tone: "bad" },
  unset: { mark: "–", tone: "dim" },
};

function CheckTag({ status, children }: { status: CheckStatus; children: ReactNode }) {
  return (
    <span className={`pf-tag ${CHECK[status].tone}`}>
      <span aria-hidden="true">{CHECK[status].mark}</span> {children}
    </span>
  );
}

// Where the owner stands: a placeholder for the dashboard the owner designs next.
function Strip({ page }: { page: Page }) {
  const s = page.live.strip;
  const known = page.live.known;
  const goal = known ? s.nextGoal : null;
  return (
    <section className="pf-strip" aria-label="Where you stand">
      <div className="card pf-tile">
        <span className="muted">Total now</span>
        <span className="pf-big">{known ? audText(s.totalAud) : "—"}</span>
        <span className="muted">
          {known ? audText(s.totalUsd, "USD") : "Live figures unavailable"}
        </span>
      </div>
      <div className="card pf-tile">
        <span className="muted">
          {goal
            ? `Next goal · ${audText(goal.amount, goal.currency)}${goal.date ? ` by ${dayText(goal.date)}` : ""}`
            : "Next goal"}
        </span>
        <span className="pf-big">{goal ? `${goal.pct}%` : known ? "Not set" : "—"}</span>
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
        {s.cash.status === "attention" && <CheckTag status="attention">Below the floor</CheckTag>}
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
        {s.month.status === "broken" && <CheckTag status="broken">Over the cap</CheckTag>}
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
