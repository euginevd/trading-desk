// Around the Profile (decision 58): its history with compare and restore, the what-if simulator,
// the rule scorecard and the Risk Officer's allocation review.
import { useCallback, useEffect, useMemo, useState } from "react";
import { getProfileVersion, getProfileVersions, getScorecard, reviewAllocation } from "./api";
import { dateTime } from "./format";
import { audText, dayText, flatten } from "./profileFields";
import { Tag } from "./ProfileCards";
import type { PlannerReview, ProfileDoc, ProfilePage, ProfileVersion, ScoreRow } from "./types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function OutOfDate({ show }: { show: boolean }) {
  return show ? (
    <Tag tone="warn" mark="▲">
      Out of date · your Profile changed
    </Tag>
  ) : null;
}

// History: every version, any two side by side, restore as a new version.

export function HistoryDrawer({
  current,
  onClose,
  onRestore,
}: {
  current: number;
  onClose: () => void;
  onRestore: (n: number) => Promise<void>;
}) {
  const [versions, setVersions] = useState<ProfileVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [docs, setDocs] = useState<Record<number, ProfileDoc>>({});
  const [busy, setBusy] = useState(false);

  const fetchVersions = useCallback(() => {
    getProfileVersions().then(
      (r) => setVersions(r.versions),
      (e: unknown) => setError(message(e, "The history couldn't be read.")),
    );
  }, []);
  useEffect(() => fetchVersions(), [fetchVersions, current]);
  const load = () => {
    setError(null);
    fetchVersions();
  };
  useEffect(() => {
    for (const n of picked)
      if (!docs[n])
        getProfileVersion(n).then(
          (v) => setDocs((d) => ({ ...d, [n]: v.profile })),
          (e: unknown) => setError(message(e, "That version couldn't be read.")),
        );
  }, [picked, docs]);

  const toggle = (n: number) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p.slice(-1), n]));
  const [a, b] = [...picked].sort((x, y) => x - y);

  return (
    <aside className="pf-drawer card" aria-label="Version history">
      <div className="pf-head">
        <h2>History</h2>
        <span className="pf-updated">Pick two to compare</span>
        <button type="button" className="pf-pencil" onClick={onClose} aria-label="Close history">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}{" "}
          <button type="button" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!versions && !error && <p className="muted">Loading the history…</p>}
      {versions?.length === 0 && (
        <p className="muted">No versions yet. Save a card to start one.</p>
      )}
      {versions && versions.length > 0 && (
        <ol className="pf-versions">
          {versions.map((v) => (
            <li key={v.n}>
              <label className="pf-check">
                <input
                  type="checkbox"
                  checked={picked.includes(v.n)}
                  onChange={() => toggle(v.n)}
                  aria-label={`Compare v${v.n}`}
                />
                <strong>v{v.n}</strong>
              </label>
              <span className="muted">{dateTime(v.time)}</span>
              <span>{v.author}</span>
              <span>
                {v.summary}
                {v.reason && <span className="muted"> · “{v.reason}”</span>}
              </span>
              {v.n !== current && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    onRestore(v.n).finally(() => setBusy(false));
                  }}
                >
                  Restore v{v.n}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {a !== undefined && b !== undefined && docs[a] && docs[b] && (
        <Compare left={a} right={b} older={docs[a]} newer={docs[b]} />
      )}
    </aside>
  );
}

function Compare({
  left,
  right,
  older,
  newer,
}: {
  left: number;
  right: number;
  older: ProfileDoc;
  newer: ProfileDoc;
}) {
  const before = flatten(older);
  const after = flatten(newer);
  const rows = before
    .map((row, i) => ({ ...row, next: after[i]?.text ?? "" }))
    .filter((row) => row.text !== row.next);
  return (
    <div className="pf-compare">
      <h3>
        v{left} against v{right}
      </h3>
      {rows.length === 0 ? (
        <p className="muted">No differences.</p>
      ) : (
        <table className="pf-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">v{left}</th>
              <th scope="col">v{right}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="muted">{r.label}</td>
                <td className="pf-pre">{r.text}</td>
                <td className="pf-pre pf-new">{r.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// The what-if simulator: read-only, it never edits the Profile.

export function project(start: number, monthly: number, yearlyPct: number, months: number) {
  const rate = yearlyPct / 100 / 12;
  const path = [start];
  let value = start;
  for (let m = 0; m < months; m += 1) {
    value = value * (1 + rate) + monthly;
    path.push(value);
  }
  return path;
}

function monthsUntil(iso: string): number {
  const now = new Date();
  const due = new Date(`${iso}T12:00:00Z`);
  return Math.max(
    (due.getUTCFullYear() - now.getUTCFullYear()) * 12 + due.getUTCMonth() - now.getUTCMonth(),
    1,
  );
}

export function WhatIf({ page }: { page: ProfilePage }) {
  const doc = page.profile;
  const strip = page.live.strip;
  const usdRate =
    Number(strip.totalUsd) > 0 ? Number(strip.totalAud) / Number(strip.totalUsd) : 1.5;
  const firstDate = doc.goals.find((g) => g.date)?.date ?? `${new Date().getFullYear() + 5}-12-31`;
  const [monthly, setMonthly] = useState(
    doc.rules.monthly_deposit_cap_aud ?? doc.income.available_monthly_aud ?? "1000",
  );
  const [ret, setRet] = useState("8");
  const [until, setUntil] = useState(firstDate);

  const months = monthsUntil(until || firstDate);
  const path = useMemo(
    () => project(Number(strip.totalAud) || 0, Number(monthly) || 0, Number(ret) || 0, months),
    [strip.totalAud, monthly, ret, months],
  );
  const due = doc.goals.filter((g) => !g.date || g.date <= (until || firstDate));
  const shownGoals = due.length ? due : doc.goals.slice(0, 1);
  const goals = shownGoals.map((g) => ({
    label: `${audText(g.amount, g.currency)}${g.date ? ` by ${dayText(g.date)}` : ""}`,
    aud: Number(g.amount) * (g.currency === "USD" ? usdRate : 1),
  }));
  const end = path[path.length - 1] ?? 0;
  const top = Math.max(end, ...goals.map((g) => g.aud), 1) * 1.08;
  const W = 600;
  const H = 220;
  const x = (i: number) => 40 + (i / Math.max(path.length - 1, 1)) * (W - 60);
  const y = (v: number) => H - 24 - (v / top) * (H - 40);

  return (
    <section className="card pf-card wide" aria-labelledby="pf-whatif">
      <div className="pf-head">
        <h2 id="pf-whatif">What if</h2>
        <span className="pf-updated">Read-only: it never changes your Profile</span>
      </div>
      <div className="pf-sim">
        <div>
          <div className="pf-field">
            <label htmlFor="pf-sim-monthly">Monthly amount (A$)</label>
            <input
              id="pf-sim-monthly"
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          </div>
          <div className="pf-field">
            <label htmlFor="pf-sim-return">Return a year (%)</label>
            <input
              id="pf-sim-return"
              inputMode="decimal"
              value={ret}
              onChange={(e) => setRet(e.target.value)}
            />
          </div>
          <div className="pf-field">
            <label htmlFor="pf-sim-until">Until</label>
            <input
              id="pf-sim-until"
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </div>
          <p className="pf-sim-result" aria-live="polite">
            About <strong>{audText(String(Math.round(end)))}</strong> by{" "}
            {dayText(until || firstDate)}
          </p>
          <ul className="pf-sim-goals">
            {goals.map((g) => (
              <li key={g.label}>
                {end >= g.aud ? (
                  <Tag tone="ok" mark="✓">
                    Reaches {g.label}
                  </Tag>
                ) : (
                  <Tag tone="warn" mark="▲">
                    Short of {g.label}
                  </Tag>
                )}
              </li>
            ))}
          </ul>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={`Projected value: about ${audText(String(Math.round(end)))} after ${months} months, against each goal`}
        >
          {goals.map((g) => (
            <g key={g.label}>
              <line
                x1={40}
                x2={W - 20}
                y1={y(g.aud)}
                y2={y(g.aud)}
                className="pf-goal-line"
                strokeDasharray="4 4"
              />
              <text x={44} y={y(g.aud) - 5} className="pf-axis">
                {g.label}
              </text>
            </g>
          ))}
          <polyline
            className="pf-path"
            fill="none"
            points={path.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          />
          <line x1={40} x2={W - 20} y1={H - 24} y2={H - 24} className="pf-axis-line" />
          <text x={40} y={H - 6} className="pf-axis">
            Now
          </text>
          <text x={W - 20} y={H - 6} className="pf-axis" textAnchor="end">
            {dayText(until || firstDate)}
          </text>
        </svg>
      </div>
    </section>
  );
}

// The rule scorecard: per set rule, buys kept and broken over 30 or 90 days.

export function Scorecard({ version }: { version: number }) {
  const [windows, setWindows] = useState<Record<string, ScoreRow[]> | null>(null);
  const [days, setDays] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const fetchScore = useCallback(() => {
    getScorecard().then(
      (r) => setWindows(r.windows),
      (e: unknown) =>
        setError(message(e, "The scorecard needs your trades and couldn't read them.")),
    );
  }, []);
  useEffect(() => fetchScore(), [fetchScore, version]);
  const load = () => {
    setError(null);
    fetchScore();
  };
  const rows = windows?.[days] ?? [];
  return (
    <div className="pf-score" aria-label="Rule scorecard">
      <div className="pf-score-head">
        <span className="muted">Scorecard</span>
        {["30", "90"].map((d) => (
          <button
            key={d}
            type="button"
            className={`pf-seg${days === d ? " on" : ""}`}
            aria-pressed={days === d}
            onClick={() => setDays(d)}
          >
            {d} days
          </button>
        ))}
      </div>
      {error && (
        <p className="pf-hint">
          {error}{" "}
          <button type="button" className="pf-link" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!windows && !error && <p className="pf-hint">Counting your buys…</p>}
      {windows && rows.length === 0 && (
        <p className="pf-hint">Set a cap, a per-trade size or a max per coin to score them.</p>
      )}
      <div className="pf-chips">
        {rows.map((r) =>
          r.broken === 0 ? (
            <Tag key={r.rule} tone="ok" mark="✓">
              {r.label}: kept {r.kept} of {r.kept}
            </Tag>
          ) : (
            <Tag key={r.rule} tone="bad" mark="✕">
              {r.label}: broken {r.broken} of {r.kept + r.broken}
              {r.brokenResultPct !== null && ` · ${r.brokenResultPct}% since`}
            </Tag>
          ),
        )}
      </div>
    </div>
  );
}

// Allocation against the Profile: Riley, the Risk Officer, explains the gaps.

export function AllocationReview({
  review,
  onDone,
}: {
  review: PlannerReview | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setError(null);
    reviewAllocation().then(
      () => {
        setBusy(false);
        onDone();
      },
      (e: unknown) => {
        setBusy(false);
        setError(message(e, "Riley couldn't review it. Try again."));
      },
    );
  };
  return (
    <section className="card pf-card wide" aria-labelledby="pf-review">
      <div className="pf-head">
        <h2 id="pf-review">Allocation against your Profile</h2>
        {review && <OutOfDate show={review.outOfDate} />}
        <span className="pf-updated">
          {review ? `Riley, Risk Officer · ${dateTime(review.time)}` : "Riley, Risk Officer"}
        </span>
        <button type="button" onClick={run} disabled={busy}>
          {busy ? "Reviewing…" : review ? "Review again" : "Ask Riley to review"}
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!review && !busy && (
        <p className="muted">
          Riley compares what you hold with your Strategy and Rules, and says what each gap would do
          over time.
        </p>
      )}
      {review && (
        <>
          <p className="pf-prose">{review.summary}</p>
          <ul className="pf-gaps">
            {review.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          {review.suggestionId && (
            <p className="pf-hint">Riley suggested a change: it's on its card, waiting for you.</p>
          )}
          <p className="pf-hint">
            AI review, advice only, from Profile v{review.profileVersion}. It changes nothing unless
            you accept a suggestion.
          </p>
        </>
      )}
    </section>
  );
}
