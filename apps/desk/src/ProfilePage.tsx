// The Profile (decisions 58, 61 and 62): the owner's plan, profile.md, and the agents who work
// inside it (TODO 10). The policy tab is a short motivation page: four widgets worked out from
// profile.md and the live portfolio, the file one click away, and a command bar that changes it
// only through a diff and Accept.
import { useCallback, useEffect, useState } from "react";
import {
  getProfileFile,
  getProfilePage,
  getProfileVersion,
  getProfileVersions,
  restoreProfile,
} from "./api";
import { dateTime } from "./format";
import { FileNote, Reader, useMarkdownFile } from "./Markdown";
import Board from "./ProfileBoard";
import MyAgents from "./MyAgents";
import CommandBar, { DiffView } from "./ProfileCommand";
import { dayOf } from "./profileFields";
import type { ProfilePage as Page, ProfileVersion, ProfileVersionDetail } from "./types";
import "./profile.css";
import "./myagents.css";

const REFRESH_MS = 60_000; // as the Portfolio page: the TAO reading is reused for a minute
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type Tab = "policy" | "agent";
const TABS: { tab: Tab; label: string }[] = [
  { tab: "policy", label: "My plan" },
  { tab: "agent", label: "My agents" },
];

// Two tabs: the owner's plan, and the agents who work inside it (#/profile?tab=agent).
export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>(() =>
    window.location.hash.includes("tab=agent") ? "agent" : "policy",
  );
  return (
    <main className="wrap pf-page">
      <div className="pf-top">
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
      </div>
      <div
        key={tab}
        id="pf-tabpanel"
        className="pf-page pf-panel"
        role="tabpanel"
        aria-labelledby={`pf-tab-${tab}`}
      >
        {tab === "policy" ? <Policy /> : <MyAgents />}
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
  // The live figures (TAO, Binance, BTC) read again every minute while the page is in view, and at
  // once when the tab comes back; a figure that moved rolls to its new value.
  useEffect(() => {
    fetchPage();
    const quiet = () => {
      if (document.visibilityState === "visible") fetchPage();
    };
    const timer = window.setInterval(quiet, REFRESH_MS);
    document.addEventListener("visibilitychange", quiet);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", quiet);
    };
  }, [fetchPage]);
  const load = () => {
    setError(null);
    fetchPage();
  };
  const saved = (next?: Page) => {
    if (next) setPage(next);
    fetchPage(); // the widgets and the file follow the new version
    doc.retry();
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
        {[0, 1, 2].map((i) => (
          <div key={i} className="card pf-skeleton" />
        ))}
        <p className="muted">Loading your Profile…</p>
      </div>
    );
  }

  const stamp = page.version && page.time ? `v${page.version}, ${dayOf(page.time)}` : null;
  const fx = page.board?.fx;
  const rate = fx?.audPerUsd ? `US$1 = A$${Number(fx.audPerUsd).toFixed(4)}` : null;
  const pending = [...page.suggestions].reverse().find((s) => s.markdown) ?? null;
  return (
    <>
      <div className="pf-title">
        <p className="pf-lead">
          Your plan. Every agent follows it.{" "}
          <span className="pf-stamp">{stamp ?? "No versions yet"}</span>
        </p>
        <span className="pf-spacer" />
        <button
          type="button"
          className="pf-quiet"
          onClick={() => setHistory(!history)}
          aria-expanded={history}
        >
          History
        </button>
        <button type="button" className="primary" onClick={() => doc.setOpen(true)}>
          View profile.md
        </button>
      </div>
      <FileNote name="profile.md" file={doc.file} version={page.version} bar />
      {history && (
        <History current={page.version} onClose={() => setHistory(false)} onRestored={saved} />
      )}
      <CommandBar pending={pending} onSaved={saved} />
      {!page.live.known && (
        <p className="pf-live-off" role="alert">
          Live figures couldn&apos;t be read, so the TAO and Binance figures show —.{" "}
          <button type="button" className="pf-link" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {page.board ? (
        <Board board={page.board} />
      ) : (
        <p className="muted">
          profile.md isn&apos;t in the numbered v2 shape yet, so there are no widgets to show.
        </p>
      )}
      {doc.open && (
        <Reader
          title="Profile"
          meta={[stamp ?? "Not saved yet", rate].filter(Boolean).join(". ")}
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

// Every version, newest first: what changed, the diff, and Restore, which saves an old version
// as a new one (history is never rewritten).
function History({
  current,
  onClose,
  onRestored,
}: {
  current: number;
  onClose: () => void;
  onRestored: (page: Page) => void;
}) {
  const [versions, setVersions] = useState<ProfileVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ProfileVersionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchVersions = useCallback(() => {
    getProfileVersions().then(
      (r) => setVersions(r.versions),
      (e: unknown) => setError(message(e, "The history couldn't be read.")),
    );
  }, []);
  useEffect(() => fetchVersions(), [fetchVersions, current]);

  const show = (n: number) => {
    if (open?.n === n) {
      setOpen(null);
      return;
    }
    getProfileVersion(n).then(setOpen, (e: unknown) =>
      setError(message(e, "That version couldn't be read.")),
    );
  };
  const restore = (n: number) => {
    if (!window.confirm(`Restore v${n}? It's saved as a new version; nothing is lost.`)) return;
    setBusy(true);
    restoreProfile(n).then(
      (page) => {
        setBusy(false);
        setOpen(null);
        onRestored(page);
      },
      (e: unknown) => {
        setBusy(false);
        setError(message(e, "That version couldn't be restored."));
      },
    );
  };

  return (
    <aside className="pf-drawer card" aria-label="Version history">
      <div className="pf-head">
        <h2>History</h2>
        <span className="pf-spacer" />
        <button type="button" className="pf-pencil" onClick={onClose} aria-label="Close history">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}{" "}
          <button
            type="button"
            className="pf-link"
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
              <div className="pf-version-row">
                <strong>
                  v{v.n}
                  {v.n === current && " · current"}
                </strong>
                <span className="muted">
                  {dateTime(v.time)} · {v.author}
                </span>
                <span className="pf-version-what">
                  {v.summary}
                  {v.reason && <span className="muted"> · {v.reason}</span>}
                </span>
                <span className="pf-version-actions">
                  <button
                    type="button"
                    className="pf-link"
                    onClick={() => show(v.n)}
                    aria-expanded={open?.n === v.n}
                  >
                    {open?.n === v.n ? "Hide diff" : "Diff"}
                  </button>
                  {v.n !== current && (
                    <button
                      type="button"
                      className="pf-link"
                      onClick={() => restore(v.n)}
                      disabled={busy}
                    >
                      Restore
                    </button>
                  )}
                </span>
              </div>
              {open?.n === v.n && <DiffView lines={open.diff} label={`What changed in v${v.n}`} />}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
