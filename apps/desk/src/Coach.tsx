// The Dashboard (decisions 52, 59 and 63): the morning check. A sentence says how the day is
// going; the week rail shows where this week's buys stand; below, what to watch and the desk to
// ask, then last week's recap in one line. Every figure comes from the api; the words are the
// model's when it has written them, the plain ones until then.
import DcaWidget from "./DcaWidget";
import { useCallback, useEffect, useState } from "react";
import {
  getAgent,
  getAgents,
  getCoach,
  getRecaps,
  getSentiment,
  sendAgent,
  writeCoach,
  writeRecap,
} from "./api";
import { km, Live } from "./Figures";
import { fetchedAt, longDate, percent, price } from "./format";
import { ResetIcon } from "./icons";
import { OutOfDate } from "./RuleMarks";
import type {
  AgentInfo,
  AgentThread,
  BuyState,
  Coach as CoachData,
  CoachWeek,
  KeyPoint,
  Recap as RecapData,
  Sentiment,
} from "./types";
import "./dashboard.css";

const REFRESH_MS = 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

function problem(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
const dayOfMonth = (iso: string) => Number(iso.slice(8, 10));
const shortDate = (iso: string) =>
  `${dayOfMonth(iso)} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;

export default function Coach() {
  const [coach, setCoach] = useState<CoachData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetched, setFetched] = useState<string | null>(null);
  const [fg, setFg] = useState<Sentiment | null>(null);
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
    getSentiment().then(
      (s) => live && setFg(s),
      () => undefined, // the rail still shows the plan without today's reading
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
          {coach.week && <WeekRail week={coach.week} fg={fg} />}
          <DcaWidget />
          <div className="dash-ledger">
            <Watch coach={coach} />
            <Desk />
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

// The week rail: Monday to Sunday, the buys on their days, today marked. Move over a day, or
// focus it, to read what it holds.
function WeekRail({ week, fg }: { week: CoachWeek; fg: Sentiment | null }) {
  const [shown, setShown] = useState<string | null>(null);
  const todayIndex = Math.max(
    0,
    week.days.findIndex((d) => d.date === week.today),
  );
  const extraOn =
    week.extra?.fearGreedBelow !== null && week.extra?.fearGreedBelow !== undefined && fg
      ? fg.value < week.extra.fearGreedBelow
      : null;
  const pick = shown ?? week.today;
  return (
    <section className="dash-week" aria-label="This week" onMouseLeave={() => setShown(null)}>
      <div className="dash-rail" style={{ ["--today" as string]: todayIndex }}>
        <span className="dash-rail-line" aria-hidden="true" />
        <span className="dash-rail-past" aria-hidden="true" />
        {week.days.map((d, i) => {
          const isToday = d.date === week.today;
          const past = d.date < week.today;
          const label = dayLabel(d.kind, week, extraOn, fg);
          return (
            <button
              key={d.date}
              type="button"
              className={`dash-day${isToday ? " today" : ""}${past ? " past" : ""}${
                d.kind
                  ? ` ${d.kind} ${state(d.kind, week)}${d.kind === "extra" && extraOn ? " on" : ""}`
                  : ""
              }${shown === d.date ? " picked" : ""}`}
              style={{ animationDelay: `${120 + i * 55}ms` }}
              aria-pressed={pick === d.date}
              aria-label={`${DAY_NAMES[d.name] ?? d.name} ${shortDate(d.date)}${
                isToday ? ", today" : ""
              }${label ? `: ${label}` : ""}`}
              onMouseEnter={() => setShown(d.date)}
              onFocus={() => setShown(d.date)}
              onClick={() => setShown(d.date)}
            >
              <span className="dash-day-name">{d.name}</span>
              <span className="dash-dot" aria-hidden="true" />
              <span className="dash-day-date">{dayOfMonth(d.date)}</span>
              {label && <span className="dash-day-label">{label}</span>}
            </button>
          );
        })}
      </div>
      <p key={pick} className="dash-readout" aria-live="polite">
        {readout(pick, week, fg, extraOn)}
      </p>
    </section>
  );
}

function state(kind: "" | "buy" | "extra", week: CoachWeek): BuyState | "" {
  if (kind === "buy") return week.buy?.state ?? "";
  if (kind === "extra") return week.extra?.state ?? "";
  return "";
}

function dayLabel(
  kind: "" | "buy" | "extra",
  week: CoachWeek,
  extraOn: boolean | null,
  fg: Sentiment | null,
): string {
  if (kind === "buy" && week.buy) {
    const amount = km(week.buy.aud);
    return {
      done: `✓ ${amount} bought`,
      due: `${amount} buy today`,
      missed: `${amount} not bought`,
      upcoming: `${amount} buy`,
      unknown: `${amount} buy`,
    }[week.buy.state];
  }
  if (kind === "extra" && week.extra) {
    if (week.extra.state === "done") return `✓ +${km(week.extra.aud)} bought`;
    if (extraOn === false) return `No extra: F&G ${fg?.value ?? "?"}`;
    if (extraOn === true) return `+${km(week.extra.aud)}: F&G ${fg?.value ?? "?"}`;
    return `+${km(week.extra.aud)} if F&G < ${week.extra.fearGreedBelow ?? "?"}`;
  }
  return "";
}

// What a day holds, in a sentence. Today without a buy says what's next.
function readout(date: string, week: CoachWeek, fg: Sentiment | null, extraOn: boolean | null) {
  const day = week.days.find((d) => d.date === date);
  if (!day) return "";
  const when =
    date === week.today ? "Today" : `${DAY_NAMES[day.name] ?? day.name} ${shortDate(date)}`;
  const buy = week.buy;
  const extra = week.extra;
  if (day.kind === "buy" && buy) {
    const amount = km(buy.aud);
    const so = {
      done: `bought ${km(buy.boughtAud)} on Binance since. Done for the week.`,
      due: "limit orders from your split; if they haven't filled by Monday evening, buy at market.",
      missed: "nothing bought since. Buy at market, as the plan says.",
      upcoming: "limit orders from your split, likely to fill within three days.",
      unknown: "Binance couldn't be read, so whether it's bought isn't known.",
    }[buy.state];
    return `${when}: your ${amount} weekly buy. ${so[0]?.toUpperCase()}${so.slice(1)}`;
  }
  if (day.kind === "extra" && extra) {
    const reading = fg ? `Fear & Greed is ${fg.value} (${fg.label.toLowerCase()})` : "";
    const rule = `+${km(extra.aud)} when Fear & Greed is under ${extra.fearGreedBelow ?? "?"}`;
    if (extra.state === "done") return `${when}: the extra ${km(extra.aud)} is bought.`;
    if (extraOn === true) return `${when}: ${rule}. ${reading}, so it applies this week.`;
    if (extraOn === false) return `${when}: ${rule}. ${reading}, so not this week.`;
    return `${when}: ${rule}.`;
  }
  const next = [buy, extra].find((b) => b && b.date > date && b.state !== "done");
  const nextText = next
    ? ` Next: ${next === buy ? `your ${km(buy?.aud)} buy` : `the extra ${km(extra?.aud)}`} on ${
        DAY_NAMES[week.days.find((d) => d.date === next.date)?.name ?? ""] ?? next.date
      }.`
    : "";
  const bought =
    week.boughtAud && Number(week.boughtAud) > 0
      ? ` ${km(week.boughtAud)} bought this week so far.`
      : "";
  return `${when}: nothing planned.${nextText}${bought}`;
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

type TeamState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; agents: AgentInfo[] };

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

// Ask the desk (decision 59): the Desk Coordinator by default, or a specialist. Advice only.
function Desk() {
  const [team, setTeam] = useState<TeamState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [chosen, setChosen] = useState("desk");
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    getAgents().then(
      (r) => live && setTeam({ kind: "ready", agents: r.agents }),
      () => live && setTeam({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [retry]);
  useEffect(() => {
    let live = true;
    getAgent(chosen).then(
      (t) => live && setThread(t),
      () => live && setThread(null),
    );
    return () => {
      live = false;
    };
  }, [chosen]);

  const send = () => {
    if (!text.trim()) return;
    setSending(true);
    sendAgent(chosen, text).then(
      (next) => {
        setThread(next);
        setText("");
        setSending(false);
      },
      () => setSending(false),
    );
  };

  const agents = team.kind === "ready" ? team.agents : [];
  const lead = agents.find((a) => a.reportsTo === null) ?? null;
  const ordered = lead ? [lead, ...agents.filter((a) => a !== lead)] : agents;
  const info = agents.find((a) => a.id === chosen);
  const shown = thread?.id === chosen ? thread : null;
  const name = info?.name ?? shown?.name ?? "the desk";

  return (
    <section className="dash-col dash-desk" aria-labelledby="dash-desk">
      <h2 id="dash-desk">Ask the desk</h2>
      {team.kind === "loading" && (
        <p className="muted" aria-busy="true">
          Meeting the team…
        </p>
      )}
      {team.kind === "error" && (
        <div className="alert" role="alert">
          <span>The team couldn&apos;t load. Check the api is running.</span>
          <button
            className="btn btn-small"
            type="button"
            onClick={() => {
              setTeam({ kind: "loading" });
              setRetry((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {ordered.length > 0 && (
        <div className="dash-team" role="group" aria-label="Who to ask">
          {ordered.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`dash-ava${a === lead ? " lead" : ""}`}
              aria-pressed={a.id === chosen}
              aria-label={`${a.name}, ${a.title}`}
              title={`${a.name}, ${a.title}: ${a.remit}`}
              onClick={() => {
                if (a.id === chosen) return;
                setThread(null);
                setChosen(a.id);
              }}
            >
              {initial(a.name)}
            </button>
          ))}
        </div>
      )}
      {info && (
        <p key={info.id} className="dash-who">
          <strong>{info.name}</strong>, {info.title}. <span className="muted">{info.remit}</span>
        </p>
      )}
      <div className="dash-thread" aria-live="polite">
        {(shown?.messages ?? []).length === 0 && <p className="muted">Ask {name} anything.</p>}
        {shown?.messages.map((m) => (
          <p key={`${m.time}-${m.role}-${m.text}`} className={`dash-bubble ${m.role}`}>
            {m.text}
          </p>
        ))}
      </div>
      <form
        className="dash-ask"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          aria-label={`Message to ${name}`}
          placeholder={`Ask ${name}…`}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
      <p className="dash-note">Advice only. Nothing is placed from the Dashboard.</p>
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
