// The trading agent (TODO 6, decision 61): who they are and how they work, from local/trade.md,
// which the owner changes by asking Claude Code. The desk only reads it.
import { useCallback, useEffect, useState } from "react";
import { getAgentFile, getTradingAgent } from "./api";
import { FileNote, Reader, useMarkdownFile } from "./Markdown";
import { dayOf } from "./profileFields";
import type { AgentFocus, AgentPage } from "./types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const FOCUS: Record<AgentFocus, string> = {
  dca: "DCA",
  swing: "Swing trades",
  both: "DCA and swing",
};
const word = (text: string) => `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;

// The agent's initials for their avatar: "Jordan" is J, "Sam Lee" is SL.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? (words[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

export default function AgentProfile() {
  const [page, setPage] = useState<AgentPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doc = useMarkdownFile(getAgentFile);
  const fetchPage = useCallback(() => {
    getTradingAgent().then(setPage, (e: unknown) =>
      setError(message(e, "Your trading agent couldn't be read.")),
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
  if (!page) {
    return (
      <div aria-busy="true">
        <div className="card pf-skeleton ag-skeleton" />
        <p className="muted">Loading your trading agent…</p>
      </div>
    );
  }

  const a = page.agent;
  const name = a.name || "Your agent";
  const stamp = page.version && page.time ? `v${page.version}, ${dayOf(page.time)}` : null;
  const model = (id: string) => page.models.find((m) => m.id === id)?.name ?? id;
  return (
    <>
      <section className="ag-sheet" aria-label={name}>
        <div className="ag-persona">
          <span className="ag-ava ag-ava-lg" aria-hidden="true">
            {initials(name)}
          </span>
          <div className="ag-who">
            <h2>{name}</h2>
            <p className="muted">
              {a.title || "Trader"}. {word(a.style)} style, {FOCUS[a.focus]}.
            </p>
          </div>
          <span className="pf-spacer" />
          <button type="button" className="primary" onClick={() => doc.setOpen(true)}>
            Show {name}&apos;s profile
          </button>
        </div>
        <dl className="pf-rows ag-facts">
          <div className="pf-row">
            <dt>Autonomy</dt>
            <dd>{word(a.autonomy)}</dd>
          </div>
          <div className="pf-row">
            <dt>Version</dt>
            <dd>{stamp ?? "Defaults, no file yet"}</dd>
          </div>
          <div className="pf-row">
            <dt>Estimated cost a run</dt>
            <dd className="num">about ${page.estimate}</dd>
          </div>
        </dl>
        {page.steps.length > 0 && (
          <>
            <h3 className="ag-steps-h">How {name} runs Analyse</h3>
            <ol className="ag-steps">
              {page.steps.map((step) => {
                const set = a.steps[step.key];
                const on = step.fixed || set.on;
                return (
                  <li key={step.key} className={on ? "" : "off"}>
                    <span className="ag-step-title">{step.title}</span>
                    <span className="muted">
                      {step.who.charAt(0).toUpperCase() + step.who.slice(1)}
                    </span>
                    <span className="ag-step-model">{on ? model(set.model) : "Off"}</span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>
      <FileNote name="trade.md" file={doc.file} version={page.version} />
      {doc.open && (
        <Reader
          title={`${name}'s profile`}
          meta={`${stamp ?? "Defaults"}. Read only`}
          markdown={doc.file?.markdown ?? null}
          error={doc.error}
          fileName="trade.md"
          onClose={() => doc.setOpen(false)}
          onRetry={doc.retry}
        />
      )}
    </>
  );
}
