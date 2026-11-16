// The Dashboard (decisions 52, 59 and 63): the morning check. A sentence says how the day is
// going, then the weekly DCA shows the buying window and where this week's buy stands. Every
// figure comes from the api; the words are the model's when it has written them.
import DcaWidget from "./DcaWidget";
import { useCallback, useEffect, useState } from "react";
import { getCoach, writeCoach } from "./api";
import { km, Live } from "./Figures";
import { fetchedAt, percent } from "./format";
import { ResetIcon } from "./icons";
import { OutOfDate } from "./RuleMarks";
import type { Coach as CoachData } from "./types";
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
  // A refresh bumps the round: the coach reads again.
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
          {/* Watch today, Ask the desk and the weekly recap are off until the desk's new
              agents arrive (TODO 10); the Dashboard is the day and the weekly DCA. */}
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
