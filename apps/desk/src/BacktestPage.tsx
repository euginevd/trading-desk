// The Backtest page (docs/plan-backtest.md, decision 85): run a style's Freqtrade backtest from
// the desk and read it in R, after TradingView's Strategy Tester and FreqUI: a run bar, the
// worker's progress, tiles, the equity curve, the breakdowns, every trade, and the kept runs
// to open or compare. Nothing here places an order.
import "./backtest.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelBacktest, getBacktestRun, getBacktests, startBacktest } from "./api";
import { dateTime, day, errorOf, inR, price } from "./format";
import type {
  BacktestJob,
  BacktestRow,
  BacktestRun,
  BacktestRunLine,
  BacktestStyleKey,
  BacktestView,
} from "./types";

const POLL_MS = 2000;
const TRADES_SHOWN = 50;
const STEPS = ["Queued", "Downloading candles", "Downloading older candles", "Testing"];
const STYLE_NAMES: Record<string, string> = {
  scalp: "Scalp",
  day: "Day trade",
  swing: "Swing",
  position: "Position",
};

const r = inR;
// Up or down only when it shows as more than zero at one place.
const tone = (n: number) => (Math.abs(n) < 0.05 ? "" : n > 0 ? "up" : "down");
const pct = (n: number) => `${Math.round(n * 100)}%`;
const dayOf = (ms: number) => day(new Date(ms));
const runName = (style: string, ai: boolean) =>
  `${STYLE_NAMES[style] ?? style}${ai ? ", AI filter" : ""}`;

function held(t: { opened: number; closed: number }): string {
  const hours = (t.closed - t.opened) / 3_600_000;
  if (hours < 48) return `${Math.max(1, Math.round(hours))}h`;
  return `${Math.round(hours / 24)} days`;
}

function elapsed(from: number, to: number): string {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function years(run: BacktestRunLine): string {
  const days = (run.to - run.from) / 86_400_000;
  if (days >= 330) {
    const y = Math.round(days / 365);
    return `${y} year${y === 1 ? "" : "s"}`;
  }
  const m = Math.max(1, Math.round(days / 30));
  return `${m} month${m === 1 ? "" : "s"}`;
}

function Sentence({ run }: { run: BacktestRun }) {
  const all = run.all;
  if (!all) {
    return (
      <h1 className="sentence">
        {runName(run.style, run.ai)} found no trades it could fill over {years(run)}.
      </h1>
    );
  }
  const best = [...run.bySetup].sort((a, b) => b.total - a.total)[0];
  return (
    <h1 className="sentence">
      {runName(run.style, run.ai)} {all.total >= 0 ? "made" : "lost"}{" "}
      <span className={tone(all.total)}>{Math.abs(all.total).toFixed(1)}R</span> over {years(run)}
      {best && best.total > 0 && run.bySetup.length > 1 && (
        <>
          ; {best.name} made <span className="up">{r(best.total)}</span>
        </>
      )}
      .
    </h1>
  );
}

// The equity curve in R, by date closed, with the compared run dashed and a hover readout.
function Curve({ run, other }: { run: BacktestRun; other: BacktestRun | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const PAD = { l: 44, r: 12, t: 12, b: 24 };
  const series = other ? [run.curve, other.curve] : [run.curve];
  const points = series.flat();
  if (run.curve.length === 0) {
    return <p className="empty">No closed trades to draw.</p>;
  }
  const xs = points.map((p) => p[0]);
  const ys = [0, ...points.map((p) => p[1])];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys, y0 + 1);
  const x = (t: number) => PAD.l + ((t - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((y1 - v) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const line = (c: [number, number][]) =>
    c.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const at = hover === null ? null : run.curve[hover];
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t =
      x0 + ((((e.clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0);
    let best = 0;
    run.curve.forEach((p, i) => {
      if (Math.abs(p[0] - t) < Math.abs((run.curve[best]?.[0] ?? 0) - t)) best = i;
    });
    setHover(best);
  };
  const last = run.curve[run.curve.length - 1]?.[1] ?? 0;
  return (
    <figure className="bt-curve">
      <figcaption className="bt-curve-head">
        <span className="label">Equity in R, trade by trade</span>
        {other && (
          <span className="bt-legend">
            <span className="bt-key is-main" aria-hidden="true" /> {runName(run.style, run.ai)}
            <span className="bt-key is-other" aria-hidden="true" /> {runName(other.style, other.ai)}{" "}
            · {dayOf(other.created)}
          </span>
        )}
      </figcaption>
      <div className="bt-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Equity curve ending at ${r(last)}${
            other ? `; the compared run ends at ${r(other.curve.at(-1)?.[1] ?? 0)}` : ""
          }`}
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
        >
          <line className="bt-zero" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
          <text className="bt-axis" x={PAD.l - 6} y={y(0) + 4} textAnchor="end">
            0R
          </text>
          {/* The high and low, unless they'd sit on the 0R label. */}
          {y(0) - y(y1) > 18 && (
            <text className="bt-axis" x={PAD.l - 6} y={y(y1) + 10} textAnchor="end">
              {r(y1, 0)}
            </text>
          )}
          {y(y0) - y(0) > 18 && (
            <text className="bt-axis" x={PAD.l - 6} y={y(y0)} textAnchor="end">
              {r(y0, 0)}
            </text>
          )}
          <text className="bt-axis" x={PAD.l} y={H - 6}>
            {dayOf(x0)}
          </text>
          <text className="bt-axis" x={W - PAD.r} y={H - 6} textAnchor="end">
            {dayOf(x1)}
          </text>
          {other && <path className="bt-line is-other" d={line(other.curve)} />}
          <path className="bt-line is-main" d={line(run.curve)} />
          {at && (
            <>
              <line className="bt-cross" x1={x(at[0])} x2={x(at[0])} y1={PAD.t} y2={H - PAD.b} />
              <circle className="bt-dot" cx={x(at[0])} cy={y(at[1])} r={4} />
            </>
          )}
        </svg>
        {at && hover !== null && (
          <div
            className="bt-tip"
            style={{ left: `${(x(at[0]) / W) * 100}%`, top: `${(y(at[1]) / H) * 100}%` }}
          >
            <b className="num">{r(at[1])}</b>
            <span>
              Trade {hover + 1} · {dayOf(at[0])}
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}

// A group's total R as a bar from a centre line, scaled to the group's largest.
function Bars({ title, rows }: { title: string; rows: BacktestRow[] }) {
  const most = Math.max(...rows.map((row) => Math.abs(row.total)), 0.001);
  return (
    <div className="bt-group">
      <h3>{title}</h3>
      <ul className="bt-bars">
        {rows.map((row) => {
          const w = (Math.abs(row.total) / most) * 50;
          return (
            <li
              key={row.name}
              title={`${row.trades} trades, ${pct(row.won)} won, ${r(row.avg, 2)} a trade`}
            >
              <span className="bt-bar-name">
                {row.name} <span className="muted">· {row.trades}</span>
              </span>
              <span className="bt-track" aria-hidden="true">
                <span
                  className={`bt-fill ${row.total >= 0 ? "is-up" : "is-down"}`}
                  style={{ left: row.total >= 0 ? "50%" : `${50 - w}%`, width: `${w}%` }}
                />
              </span>
              <b className={`num ${tone(row.total)}`}>{r(row.total)}</b>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Tiles({ run, other }: { run: BacktestRun; other: BacktestRun | null }) {
  const vs = (f: (x: BacktestRun) => string, cls?: (x: BacktestRun) => string) =>
    other ? (
      <small>
        Compared: <span className={cls?.(other) ?? ""}>{f(other)}</span>
      </small>
    ) : null;
  const tiles: [string, (x: BacktestRun) => string, ((x: BacktestRun) => string)?][] = [
    ["Trades", (x) => String(x.all?.trades ?? 0)],
    ["Won", (x) => (x.all ? pct(x.all.won) : "–")],
    ["Average a trade", (x) => (x.all ? r(x.all.avg, 2) : "–"), (x) => tone(x.all?.avg ?? 0)],
    ["Total", (x) => (x.all ? r(x.all.total) : "–"), (x) => tone(x.all?.total ?? 0)],
    ["Worst run from a high", (x) => r(x.worstRun), (x) => tone(x.worstRun)],
  ];
  return (
    <div className="bt-tiles">
      {tiles.map(([label, f, cls]) => (
        <div key={label} className="bt-tile">
          <span className="label">{label}</span>
          <b className={`num ${cls?.(run) ?? ""}`}>{f(run)}</b>
          {vs(f, cls)}
        </div>
      ))}
    </div>
  );
}

function Trades({ run }: { run: BacktestRun }) {
  const [all, setAll] = useState(false);
  const shown = all ? run.trades : run.trades.slice(0, TRADES_SHOWN);
  const exitTag = (e: string) => (e === "Target" ? "buy" : e === "Stop" ? "sell" : "wait");
  return (
    <section className="panel" aria-labelledby="bt-trades">
      <div className="panel-head">
        <h2 id="bt-trades">Trades</h2>
        <span className="muted">{run.trades.length}, newest first</span>
      </div>
      {run.trades.length === 0 ? (
        <p className="empty">The rule found no setups it could fill in these dates.</p>
      ) : (
        <>
          <div className="scroll">
            <table className="bt-table">
              <thead>
                <tr>
                  <th scope="col">Coin</th>
                  <th scope="col">Setup</th>
                  <th scope="col">Opened</th>
                  <th scope="col" className="r">
                    Held
                  </th>
                  <th scope="col" className="r">
                    Entry
                  </th>
                  <th scope="col" className="r">
                    Stop
                  </th>
                  <th scope="col" className="r">
                    Target
                  </th>
                  <th scope="col" className="r">
                    Exit
                  </th>
                  <th scope="col">How</th>
                  <th scope="col" className="r">
                    R
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={`${t.pair}-${t.opened}`}>
                    <td>{t.coin}</td>
                    <td>{t.setup}</td>
                    <td>{dayOf(t.opened)}</td>
                    <td className="r num">{held(t)}</td>
                    <td className="r num">{price(String(t.entry))}</td>
                    <td className="r num">{price(String(t.stop))}</td>
                    <td className="r num">{price(String(t.target))}</td>
                    <td className="r num">{price(String(t.exit))}</td>
                    <td>
                      <span className={`tag ${exitTag(t.exitReason)}`}>{t.exitReason}</span>
                    </td>
                    <td className={`r num ${tone(t.r)}`}>{r(t.r, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {run.trades.length > TRADES_SHOWN && (
            <button type="button" className="btn btn-small bt-more" onClick={() => setAll(!all)}>
              {all ? `Show the newest ${TRADES_SHOWN}` : `Show all ${run.trades.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Progress({
  job,
  now,
  workerOn,
  onCancel,
}: {
  job: BacktestJob;
  now: number;
  workerOn: boolean;
  onCancel: () => void;
}) {
  const at = job.state === "queued" ? 0 : Math.max(1, STEPS.indexOf(job.step ?? ""));
  return (
    <section className="panel bt-progress" aria-live="polite" aria-labelledby="bt-job">
      <div className="panel-head">
        <h2 id="bt-job">
          {runName(job.style, job.ai)} · {day(new Date(job.from))} to {day(new Date(job.to))}
        </h2>
        <span className="muted num">{elapsed(job.started ?? job.created, now)}</span>
      </div>
      <ol className="bt-steps">
        {[...STEPS, "Reading the result"].map((s, i) => (
          <li key={s} className={i < at ? "is-done" : i === at ? "is-now" : ""}>
            {i < at ? "Done: " : i === at ? "Now: " : ""}
            {s}
          </li>
        ))}
      </ol>
      {job.state === "queued" && !workerOn && (
        <p className="wait">
          Waiting for the backtest worker. Start it with{" "}
          <code>docker compose up -d backtest-worker</code>.
        </p>
      )}
      {job.log.length > 0 && <pre className="bt-log">{job.log.slice(-4).join("\n")}</pre>}
      <button type="button" className="btn btn-small" onClick={onCancel} disabled={job.cancelling}>
        {job.cancelling ? "Cancelling…" : "Cancel run"}
      </button>
    </section>
  );
}

function RunBar({
  view,
  busy,
  onRun,
}: {
  view: BacktestView;
  busy: boolean;
  onRun: (run: { style: BacktestStyleKey; ai: boolean; from: string; to: string }) => void;
}) {
  const [key, setKey] = useState<BacktestStyleKey>("swing");
  const style = view.styles.find((s) => s.key === key) ?? view.styles[0];
  const [ai, setAi] = useState(false);
  const [from, setFrom] = useState(style?.from ?? "");
  const [to, setTo] = useState(style?.to ?? "");
  if (!style) return null;
  const pick = (k: BacktestStyleKey) => {
    const s = view.styles.find((x) => x.key === k);
    if (!s) return;
    setKey(k);
    setFrom(s.from);
    setTo(s.to);
    if (!s.ai) setAi(false);
  };
  return (
    <section className="panel" aria-labelledby="bt-new">
      <div className="panel-head">
        <h2 id="bt-new">New run</h2>
        <span className="muted">
          {style.name}: {style.candles} candles, takes {style.takes}
        </span>
      </div>
      <form
        className="bt-runbar"
        onSubmit={(e) => {
          e.preventDefault();
          onRun({ style: key, ai, from, to });
        }}
      >
        <div className="views" role="group" aria-label="Style">
          {view.styles.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={s.key === key}
              onClick={() => pick(s.key)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <label className="bt-check">
          <input
            type="checkbox"
            checked={ai}
            disabled={!style.ai}
            onChange={(e) => setAi(e.target.checked)}
          />
          AI filter (FreqAI)
        </label>
        <label className="bt-date">
          <span className="label">From</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
        </label>
        <label className="bt-date">
          <span className="label">To</span>
          <input
            type="date"
            value={to}
            max={style.to}
            onChange={(e) => setTo(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn btn-accent" disabled={busy}>
          Run {style.name.toLowerCase()} backtest{ai ? " with AI" : ""}
        </button>
      </form>
      {!style.ai && (
        <p className="muted bt-note">
          Position has no AI filter: too few weekly candles a coin to learn from.
        </p>
      )}
    </section>
  );
}

function Runs({
  runs,
  open,
  onOpen,
}: {
  runs: BacktestRunLine[];
  open: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="panel" aria-labelledby="bt-runs">
      <div className="panel-head">
        <h2 id="bt-runs">Runs</h2>
        <span className="muted">Kept in local/backtest, run.sh&apos;s runs too</span>
      </div>
      <div className="scroll">
        <table className="bt-table bt-runs">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Style</th>
              <th scope="col">Dates</th>
              <th scope="col" className="r">
                Trades
              </th>
              <th scope="col" className="r">
                Won
              </th>
              <th scope="col" className="r">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} aria-current={run.id === open ? "true" : undefined}>
                <td>
                  <button type="button" className="bt-open" onClick={() => onOpen(run.id)}>
                    {dateTime(run.created)}
                  </button>
                </td>
                <td>{runName(run.style, run.ai)}</td>
                <td>
                  {dayOf(run.from)} to {dayOf(run.to)}
                </td>
                <td className="r num">{run.all?.trades ?? 0}</td>
                <td className="r num">{run.all ? pct(run.all.won) : "–"}</td>
                <td className={`r num ${tone(run.all?.total ?? 0)}`}>
                  {run.all ? r(run.all.total) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function BacktestPage() {
  const [view, setView] = useState<BacktestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [otherId, setOtherId] = useState("");
  const [other, setOther] = useState<BacktestRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const watched = useRef<string | null>(null);

  const load = useCallback(() => {
    getBacktests().then(
      (v) => {
        setView(v);
        setError(null);
        setNow(Date.now());
        setOpenId((id) => id ?? v.runs[0]?.id ?? null);
        // The run just finished: open its result.
        const job = v.job;
        if (job && watched.current === job.id && job.state === "done" && job.result) {
          watched.current = null;
          setOpenId(job.result);
        }
      },
      (e: unknown) => setError(errorOf(e, "The backtests couldn't be read.")),
    );
  }, []);
  useEffect(() => load(), [load]);

  const going = view?.job?.state === "queued" || view?.job?.state === "running";
  useEffect(() => {
    if (!going) return;
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [going, load]);

  useEffect(() => {
    if (!openId) return;
    getBacktestRun(openId).then(
      (found) => {
        setRun(found);
        setRunError(null);
      },
      (e: unknown) => setRunError(errorOf(e, "That run couldn't be read.")),
    );
  }, [openId, tries]);
  useEffect(() => {
    if (!otherId) return;
    getBacktestRun(otherId).then(setOther, () => setOther(null));
  }, [otherId]);
  const compared = otherId && other?.id === otherId ? other : null;

  const choices = useMemo(() => (view?.runs ?? []).filter((x) => x.id !== openId), [view, openId]);

  if (error && !view) {
    return (
      <main className="wrap page-stack page-dense">
        <h1 className="sentence">Backtests</h1>
        <div className="alert" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-small" onClick={load}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="wrap page-stack page-dense" aria-busy="true">
        <div className="skeleton" style={{ height: 44, maxWidth: 560 }} />
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 300 }} />
      </main>
    );
  }

  const job = view.job;
  const start = (wanted: { style: BacktestStyleKey; ai: boolean; from: string; to: string }) => {
    setBusy(true);
    setSaid(null);
    startBacktest(wanted)
      .then(
        (v) => {
          watched.current = v.job?.id ?? null;
          setView(v);
          setNow(Date.now());
        },
        (e: unknown) => setSaid(errorOf(e, "The run wasn't queued. Try again.")),
      )
      .finally(() => setBusy(false));
  };
  const cancel = () => {
    if (!job) return;
    cancelBacktest(job.id).then(setView, (e: unknown) =>
      setSaid(errorOf(e, "The run wasn't cancelled. Try again.")),
    );
  };
  const failed = job && job.state === "failed" ? job : null;
  const shown = run && run.id === openId ? run : null;

  return (
    <main className="wrap page-stack page-dense bt">
      <div>
        {going && job ? (
          <h1 className="sentence">Testing {runName(job.style, job.ai).toLowerCase()}…</h1>
        ) : shown ? (
          <Sentence run={shown} />
        ) : view.runs.length === 0 ? (
          <h1 className="sentence">No backtests yet.</h1>
        ) : (
          <h1 className="sentence">Backtests</h1>
        )}
        <p className="lede">
          Each style&apos;s own rule on years of Binance candles, sized and stopped as the desk
          does. Freqtrade runs it; nothing is ever placed.
        </p>
      </div>

      {!view.worker.on && !going && (
        <div className="alert notice" role="status">
          <span>
            The backtest worker isn&apos;t running, so a new run would wait. Start it with{" "}
            <code>docker compose up -d backtest-worker</code>.
          </span>
        </div>
      )}
      {said && (
        <div className="alert" role="alert">
          <span>{said}</span>
        </div>
      )}

      {going && job ? (
        <Progress job={job} now={now} workerOn={view.worker.on} onCancel={cancel} />
      ) : (
        <RunBar view={view} busy={busy} onRun={start} />
      )}

      {failed && (
        <section className="panel bt-failed" role="alert" aria-labelledby="bt-failed">
          <div className="panel-head">
            <h2 id="bt-failed">
              {runName(failed.style, failed.ai)} failed
              {failed.started && failed.finished
                ? ` after ${elapsed(failed.started, failed.finished)}`
                : ""}
            </h2>
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                start({ style: failed.style, ai: failed.ai, from: failed.from, to: failed.to })
              }
            >
              Run again
            </button>
          </div>
          <p className="muted">{failed.error ?? "Freqtrade stopped."} Its last lines:</p>
          {failed.log.length > 0 && <pre className="bt-log">{failed.log.join("\n")}</pre>}
        </section>
      )}

      {view.runs.length === 0 ? (
        <section className="panel">
          <p className="empty">
            Pick a style and press Run. Swing takes under a minute; the result and every trade show
            here, and each run is kept to compare.
          </p>
        </section>
      ) : runError ? (
        <div className="alert" role="alert">
          <span>{runError}</span>
          <button type="button" className="btn btn-small" onClick={() => setTries((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : !shown ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : (
        <>
          <section className="panel" aria-labelledby="bt-result">
            <div className="panel-head">
              <h2 id="bt-result">
                {runName(shown.style, shown.ai)} · {dayOf(shown.from)} to {dayOf(shown.to)} ·{" "}
                {shown.pairs} coins
              </h2>
              <label className="bt-compare">
                <span className="muted">Compare with</span>
                <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                  <option value="">None</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {runName(c.style, c.ai)} · {dateTime(c.created)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Tiles run={shown} other={compared} />
            <div className="bt-grid">
              <Curve run={shown} other={compared} />
              <div className="bt-groups">
                <Bars title="By setup" rows={shown.bySetup} />
                <Bars title="By exit" rows={shown.byExit} />
                <Bars title="By year" rows={shown.byYear} />
              </div>
            </div>
          </section>
          <Trades key={shown.id} run={shown} />
        </>
      )}

      {view.runs.length > 0 && (
        <Runs
          runs={view.runs}
          open={openId}
          onOpen={(id) => {
            setOpenId(id);
            if (id === otherId) setOtherId("");
            window.scrollTo({ top: 0 });
          }}
        />
      )}
    </main>
  );
}
