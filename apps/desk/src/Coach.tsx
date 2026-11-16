// The Dashboard (decisions 52, 59 and 63): the morning check. A sentence says how the day is
// going; the weekly DCA shows the buying window and where this week's buy stands; below, what to
// watch and the desk to ask, then last week's recap in one line. Every figure comes from the api; the words are the
// model's when it has written them, the plain ones until then.
import DcaWidget from "./DcaWidget";
import { useCallback, useEffect, useState } from "react";
import { getCoach, getRecaps, writeCoach, writeRecap } from "./api";
import { km, Live } from "./Figures";
import { fetchedAt, longDate, percent, price } from "./format";
import { ResetIcon } from "./icons";
import { OutOfDate } from "./RuleMarks";
import type { Coach as CoachData, KeyPoint, Recap as RecapData } from "./types";
import "./dashboard.css";

const REFRESH_MS = 60_000;

function problem(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function Coach() {
  const [coach, setCoach] = useState<CoachData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetched, setFetched] = useState<string | null>(null);
  // A refresh bumps the round: the coach and the recap read again.
  const [round, setRound] = useState(0);

  const load = useCallback((quiet: boolean) => {
    let live = true;
    getCoach().then(
      (data) => {
        if (!live) return;
        setCoach(data);
        setError(null);
        setLoading(false);
        setFetched(new Date().toISOString());
        // The model words today's message once; it's kept, so this only runs when it's new.
        if (data.pending)
          writeCoach().then(
            (next) => live && setCoach(next),
            () => undefined,
          );
      },
      (e: unknown) => {
        if (!live) return;
        if (!quiet) setError(problem(e, "The Dashboard couldn't load."));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => load(false), [load, round]);
  // Figures read again every minute while the page is in view; one that moved rolls.
  useEffect(() => {
    const quiet = () => {
      if (document.visibilityState === "visible") load(true);
    };
    const timer = window.setInterval(quiet, REFRESH_MS);
    document.addEventListener("visibilitychange", quiet);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", quiet);
    };
  }, [load]);

  const refresh = () => {
    setLoading(true);
    setError(null);
    setRound((r) => r + 1);
  };

  return (
    <main className="wrap dash">
      <h1 className="visually-hidden">Dashboard</h1>
      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <button className="btn btn-small" type="button" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {coach ? (
        <>
          <Hero coach={coach} fetched={fetched} loading={loading} onRefresh={refresh} />
          <DcaWidget />
          {/* Ask the desk is off until the desk's new agents arrive (TODO 10). */}
          <div className="dash-ledger is-single">
            <Watch coach={coach} />
          </div>
          <RecapLine round={round} />
        </>
      ) : (
        !error && (
          <p className="muted dash-loading" aria-busy="true">
            Reading your portfolio and your plan…
          </p>
        )
      )}
    </main>
  );
}

// The day in one sentence, the coach's words under it.
function Hero({
  coach,
  fetched,
  loading,
  onRefresh,
}: {
  coach: CoachData;
  fetched: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const pct = Number(coach.changePct);
  const aud = Number(coach.changeAud);
  const verb = pct < 0 ? "Down" : "Up"; // the coach's line under it says how the day feels
  const signed = `${aud < 0 ? "−" : "+"}${km(Math.abs(aud))}`;
  const { message } = coach;
  return (
    <section className="dash-hero" aria-labelledby="dash-day">
      <p className="dash-hello">
        <span>{coach.greeting}</span>
        <span className="dash-stamp">{fetched ? `Fetched ${fetchedAt(fetched)}` : "Fetching"}</span>
        <button
          className={`icon-btn refresh-btn${loading ? " spinning" : ""}`}
          type="button"
          aria-label={loading ? "Refreshing" : "Refresh"}
          title="Refresh"
          onClick={onRefresh}
          disabled={loading}
        >
          <ResetIcon />
        </button>
      </p>
      <h2 id="dash-day" className="dash-headline">
        {verb} <Live value={coach.changePct}>{percent(String(Math.abs(pct)), false)}</Live> today,{" "}
        <Live value={coach.changeAud}>
          <span className={aud < 0 ? "down" : "up"}>{signed}</span>
        </Live>
        .
      </h2>
      <div className="dash-lead" aria-live="polite">
        {message.lines.map((line, i) => (
          <p key={`${i}-${line}`}>{line}</p>
        ))}
        {message.outOfDate && <OutOfDate />}
        {message.link === "trade" && (
          <p>
            <a href="#/trade">Go to Trade</a>
          </p>
        )}
      </div>
    </section>
  );
}

export function pointText(p: KeyPoint): string {
  switch (p.kind) {
    case "concentration":
      return `${p.coin} is ${p.pct}% of your portfolio, over your ${p.cap}% cap.`;
    case "loss":
      return `${p.coin} is ${percent(p.pct)} on its cost, past your ${p.cap}% max loss.`;
    case "mover":
      return `${p.coin} moved most of what you hold: ${percent(p.pct)} today.`;
    case "addZone":
      return `${p.coin} is in its add zone (${price(p.low)} to ${price(p.high)}) on its last plan.`;
    case "nearInvalidation":
      return `${p.coin} is ${percent(p.pct, false)} above its invalidation level (${price(p.price)}).`;
  }
}

// What to watch today: the key points, then this month's deposits against the cap.
function Watch({ coach }: { coach: CoachData }) {
  const d = coach.deposits;
  const used = Math.min(Number(d.usedPct ?? 0), 100);
  return (
    <section className="dash-col" aria-labelledby="dash-watch">
      <h2 id="dash-watch">Watch today</h2>
      {coach.keyPoints.length === 0 ? (
        <p className="muted dash-empty">Nothing stands out today.</p>
      ) : (
        <ul className="dash-points">
          {coach.keyPoints.map((p, i) => (
            <li key={`${p.kind}-${p.coin}`} style={{ animationDelay: `${500 + i * 60}ms` }}>
              <strong>{p.coin}</strong>
              <span>{pointText(p).slice(p.coin.length + 1)}</span>
              {p.rule && <span className="dash-rule">Rule</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="dash-deposits">
        <h3>Deposited this month</h3>
        {!d.known ? (
          <p className="muted">Binance&apos;s deposit history couldn&apos;t be read just now.</p>
        ) : (
          <>
            <p className="dash-dep-line">
              <strong>
                <Live value={d.monthAud}>{km(d.monthAud)}</Live>
              </strong>
              {d.capAud ? (
                <span className="muted">
                  {" "}
                  of your {km(d.capAud)} cap.{" "}
                  {d.overAud ? (
                    <span className="dash-over">{km(d.overAud)} over.</span>
                  ) : (
                    `${km(d.leftAud)} left.`
                  )}
                </span>
              ) : (
                <span className="muted"> No monthly cap set.</span>
              )}
            </p>
            {d.capAud && (
              <div
                className={`dash-bar${d.overAud ? " over" : ""}`}
                role="progressbar"
                aria-label="This month's deposits against the cap"
                aria-valuenow={used}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i style={{ width: `${used}%` }} />
              </div>
            )}
            <p className="dash-note">{coach.message.source === "model" && coach.message.coach}</p>
          </>
        )}
        {d.lesson && (
          <p className="dash-lesson">
            <span className="muted">Lesson: </span>
            {d.lesson.text}
          </p>
        )}
        {!d.capAud && (
          <a className="dash-link" href="#/profile">
            Set a monthly cap on your Profile
          </a>
        )}
      </div>
    </section>
  );
}

type RecapState =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; recaps: RecapData[] };

// Last week's recap (decision 58) in one line; open it for the rest.
function RecapLine({ round }: { round: number }) {
  const [state, setState] = useState<RecapState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    getRecaps().then(
      (r) => live && setState({ kind: "ready", recaps: r.recaps }),
      (e: unknown) =>
        live && setState({ kind: "error", message: problem(e, "The recaps couldn't load.") }),
    );
    return () => {
      live = false;
    };
  }, [round, retry]);

  const write = () => {
    setWriting(true);
    setWriteError("");
    writeRecap().then(
      ({ recap }) => {
        setState((s) => ({
          kind: "ready",
          recaps: [
            recap,
            ...(s.kind === "ready" ? s.recaps : []).filter((r) => r.week !== recap.week),
          ],
        }));
        setWriting(false);
        setOpen(true);
      },
      (e: unknown) => {
        setWriteError(problem(e, "The recap couldn't be written. Try again."));
        setWriting(false);
      },
    );
  };

  const [newest, ...past] = state.kind === "ready" ? state.recaps : [];
  return (
    <section className="dash-recap" aria-labelledby="dash-recap">
      <div className="dash-recap-line">
        <h2 id="dash-recap">Last week</h2>
        {state.kind === "loading" && <span className="muted">Reading your recaps…</span>}
        {state.kind === "error" && (
          <span role="alert">
            {state.message}{" "}
            <button
              type="button"
              className="dash-link"
              onClick={() => {
                setState({ kind: "loading" });
                setRetry((n) => n + 1);
              }}
            >
              Try again
            </button>
          </span>
        )}
        {state.kind === "ready" && !newest && (
          <span className="muted">Your first recap comes on Sunday at 6 pm.</span>
        )}
        {newest && <span className="dash-recap-headline">{newest.headline}</span>}
        {newest?.outOfDate && <OutOfDate />}
        <span className="dash-spacer" />
        {newest && (
          <button
            type="button"
            className="dash-link"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Close" : "Read the recap"}
          </button>
        )}
        <button type="button" className="dash-link" disabled={writing} onClick={write}>
          {writing ? "Writing…" : "Write now"}
        </button>
      </div>
      {writeError && (
        <p className="error-text" role="alert">
          {writeError}
        </p>
      )}
      {open && newest && (
        <div className="dash-recap-body">
          <p className="muted">
            Week to {longDate(newest.week)},{" "}
            {newest.source === "model"
              ? "written by the AI from your figures."
              : "a plain summary of your figures."}
          </p>
          {newest.lines.length > 0 && (
            <ul>
              {newest.lines.map((line, i) => (
                <li key={`${i}-${line}`}>{line}</li>
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <details>
              <summary>Earlier weeks ({past.length})</summary>
              <ul>
                {past.map((r) => (
                  <li key={r.week}>
                    {r.headline} <span className="muted">Week to {longDate(r.week)}.</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
