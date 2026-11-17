// risk-agent's page (local/agents/risk-agent.md): one sentence on how the rules stand, every
// limit the Profile sets as a gauge (kept, near or broken) grouped by book, and risk-agent's
// weekly review. The figures are the desk's own; the model only writes the review.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { getRiskBoard, writeRiskReview } from "./api";
import { errorOf } from "./format";
import AgentAvatar from "./AgentIcons";
import { when } from "./dcaFormat";
import type { RiskBoard, RiskLimit } from "./types";
import "./risk.css";

const AREAS = ["Trading pot", "DCA book", "Deposits", "Portfolio"] as const;
const STATE = { kept: "Kept", near: "Near", broken: "Broken" } as const;

// The gauge: the figure as a fill, the warning band and the limit as ticks.
function Gauge({ row }: { row: RiskLimit }) {
  const value = Math.max(0, Number(row.value));
  const warn = row.warn === null ? null : Number(row.warn);
  const limit = row.limit === null ? null : Number(row.limit);
  const top = Math.max(value, limit ?? warn ?? value) * 1.15 || 1;
  const at = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  return (
    <span className={`rk-gauge is-${row.state}`} aria-hidden="true">
      {warn !== null && (
        <span
          className="rk-band"
          style={{ left: at(warn), right: limit === null ? 0 : `calc(100% - ${at(limit)})` }}
        />
      )}
      <span className="rk-fill" style={{ "--w": at(value) } as CSSProperties} />
      {warn !== null && warn !== limit && (
        <span className="rk-tick is-warn" style={{ left: at(warn) }} />
      )}
      {limit !== null && <span className="rk-tick is-limit" style={{ left: at(limit) }} />}
    </span>
  );
}

function Row({ row }: { row: RiskLimit }) {
  return (
    <li className={`rk-row is-${row.state}`}>
      <div className="rk-name">
        <b>{row.name}</b>
        <small className="muted">
          Profile {row.rule}, {row.owner}
        </small>
      </div>
      <Gauge row={row} />
      <div className="rk-figure">
        <b className="num">{row.figure}</b>
        <small className="muted">of {row.of}</small>
      </div>
      <span className={`rk-state is-${row.state}`}>{STATE[row.state]}</span>
      {row.words && <p className="rk-words muted">{row.words}</p>}
    </li>
  );
}

export default function RiskPage() {
  const [board, setBoard] = useState<RiskBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(() => {
    getRiskBoard().then(
      (b) => {
        setBoard(b);
        setError(null);
      },
      (e: unknown) => setError(errorOf(e, "The risk board couldn't be read.")),
    );
  }, []);
  useEffect(() => load(), [load]);

  if (error && !board) {
    return (
      <main className="wrap dcb rk">
        <h1>Risk</h1>
        <div className="alert" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-small" onClick={load}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!board) {
    return (
      <main className="wrap dcb rk" aria-busy="true">
        <p className="muted">risk-agent is reading every book…</p>
      </main>
    );
  }

  const count = (s: RiskLimit["state"]) => board.limits.filter((r) => r.state === s).length;
  const broken = count("broken");
  const near = count("near");
  const check = board.jobs.find((j) => j.key === "risk-check");
  const write = () => {
    setWriting(true);
    setSaid(null);
    writeRiskReview().then(
      (b) => {
        setBoard(b);
        setWriting(false);
      },
      (e: unknown) => {
        setWriting(false);
        setSaid(errorOf(e, "risk-agent couldn't write the review. Try again in a minute."));
      },
    );
  };

  return (
    <main className="wrap dcb rk">
      <div className="dcb-top">
        <div className="rk-lead">
          <AgentAvatar icon="risk" slug="risk-agent" on={board.scheduleOn} size="lg" />
          <div>
            <h1 className={`dcb-headline rk-said${broken ? " is-broken" : near ? " is-near" : ""}`}>
              {board.sentence}
            </h1>
            <p className="muted dcb-sub">
              risk-agent checks every evening at 9pm and tells you only when a limit gets worse; it
              writes a review on Sundays. It never trades.
              {check?.last ? ` Last check ${when(check.last.at)}.` : ""}
            </p>
          </div>
        </div>
        <dl className="dcb-totals">
          <div>
            <dt>Kept</dt>
            <dd className="num rk-n is-kept">{count("kept")}</dd>
          </div>
          <div>
            <dt>Near a limit</dt>
            <dd className="num rk-n is-near">{near}</dd>
          </div>
          <div>
            <dt>Broken</dt>
            <dd className="num rk-n is-broken">{broken}</dd>
          </div>
        </dl>
      </div>

      {board.missing.length > 0 && (
        <p className="dcb-warn" role="alert">
          Not read just now: {board.missing.join(", ")}. Their limits are left out, not shown as
          kept.
        </p>
      )}

      <div className="rk-cols">
        <div className="rk-board">
          {AREAS.map((area) => {
            const rows = board.limits.filter((r) => r.area === area);
            if (!rows.length) return null;
            return (
              <section key={area} className="dcb-section" aria-label={area}>
                <div className="dcb-section-head">
                  <h2>{area}</h2>
                  <span className="muted">
                    {rows.every((r) => r.state === "kept")
                      ? "All kept"
                      : `${rows.filter((r) => r.state !== "kept").length} to watch`}
                  </span>
                </div>
                <ul className="rk-rows">
                  {rows.map((r) => (
                    <Row key={r.key} row={r} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <aside className="rk-side" aria-label="risk-agent's review">
          <h2>Weekly review</h2>
          {board.review ? (
            <>
              <p className="rk-head">{board.review.headline}</p>
              <small className="muted">Written {when(board.review.at)}</small>
              {board.review.sections.map((s) => (
                <div key={s.title} className="rk-sec">
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              ))}
              {board.review.action && (
                <p className="rk-action">
                  <b>This week:</b> {board.review.action}
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              No review yet. risk-agent writes one on Sundays at 6pm from the board, or now.
            </p>
          )}
          <button type="button" className="btn" disabled={writing} onClick={write}>
            {writing ? "risk-agent is writing… about a minute" : "Write the review now"}
          </button>
          {said && (
            <p className="error-text" role="alert">
              {said}
            </p>
          )}
          <h3 className="rk-jobs-title">Runs on its own</h3>
          <ul className="rk-jobs">
            {board.jobs.map((j) => (
              <li key={j.key}>
                <b>{j.when}</b>, {j.label}
                <small className="muted">
                  {!board.scheduleOn
                    ? "Paused in Profile, My agents."
                    : j.last
                      ? ` Last: ${j.last.line}`
                      : " Hasn't run yet."}
                </small>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
