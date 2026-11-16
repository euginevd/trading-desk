// My agents (TODO 10): agents named by purpose, one file each in local/agents/. The page is a
// week rota, one row per agent with a dot for each time it wakes, so ten agents still read at a
// glance; opening a row gives its few facts, its week in words, and the file itself.
import { useCallback, useEffect, useState } from "react";
import { getMyAgentFile, getMyAgents, setAgentsOn } from "./api";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import { Reader } from "./Markdown";
import { dayOf } from "./profileFields";
import type { MyAgent, MyAgentSlot, MyAgentsPage } from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEK = 7 * 1440;

// 1020 is "5pm", 1110 is "6:30pm".
export function clockOf(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

const timed = (s: MyAgentSlot): s is MyAgentSlot & { day: number; minute: number } =>
  s.day !== null && s.minute !== null;
const sentence = (text: string) => `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
const AUTONOMY: Record<string, string> = {
  propose: "Proposes; you approve each order",
  auto: "Acts within your rules",
};

// Where this moment sits in the week, Monday 00:00 to Sunday 24:00, for the now line.
function weekMinute(at: Date): number {
  return ((at.getDay() + 6) % 7) * 1440 + at.getHours() * 60 + at.getMinutes();
}

// "Fri 5pm", or "Daily 11:15am" for an item that runs every day (day -1).
const whenOf = (s: { day: number; minute: number }) =>
  `${s.day < 0 ? "Daily" : DAYS[s.day]} ${clockOf(s.minute)}`;

// "today 11:15am", "tomorrow 7pm", "Fri 7pm", and "in 2h 10m" when it's within a day.
export function soonWords(at: number, from: number): { when: string; in: string | null } {
  const d = new Date(at);
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((at - start.getTime()) / 86_400_000);
  const clock = clockOf(d.getHours() * 60 + d.getMinutes());
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : DAYS[(d.getDay() + 6) % 7];
  const left = at - from;
  const h = Math.floor(left / 3_600_000);
  const m = Math.round((left % 3_600_000) / 60_000);
  return {
    when: `${day} ${clock}`,
    in: left > 0 && left < 86_400_000 ? (h ? `in ${h}h ${m}m` : `in ${m}m`) : null,
  };
}

// The row's next run: a job the scheduler runs, else the file's next item (by hand).
function nextOf(agent: MyAgent): { at: number; label: string; auto: boolean } | null {
  const job = [...(agent.jobs ?? [])].sort((a, b) => a.next - b.next)[0];
  if (job) return { at: job.next, label: job.label, auto: true };
  return agent.next ? { at: agent.next.at, label: agent.next.label, auto: false } : null;
}

function lastOf(agent: MyAgent) {
  return (agent.jobs ?? [])
    .flatMap((j) => (j.last ? [{ ...j.last, label: j.label }] : []))
    .sort((a, b) => b.at - a.at)[0];
}

function Track({ agent, now }: { agent: MyAgent; now: number }) {
  // A daily item puts a dot on every day; only the next one is ringed.
  const nextDay = agent.next ? (new Date(agent.next.at).getDay() + 6) % 7 : -2;
  const slots = agent.schedule
    .filter(timed)
    .flatMap((s) =>
      s.day < 0 ? DAYS.map((_, d) => ({ ...s, day: d, daily: true })) : [{ ...s, daily: false }],
    );
  return (
    <div className="ma-track" aria-hidden="true">
      {DAYS.map((d) => (
        <span key={d} className="ma-day" />
      ))}
      <span className="ma-now" style={{ left: `${(now / WEEK) * 100}%` }} />
      {slots.map((s) => {
        const next = agent.next?.label === s.label && (!s.daily || s.day === nextDay);
        return (
          <span
            key={`${s.day}-${s.minute}`}
            className={`ma-dot${next ? " is-next" : ""}`}
            style={{ left: `${((s.day * 1440 + s.minute) / WEEK) * 100}%` }}
            title={`${s.daily ? "Daily" : DAYS[s.day]} ${clockOf(s.minute)}: ${s.label}`}
          />
        );
      })}
    </div>
  );
}

function Detail({ agent, now, onRead }: { agent: MyAgent; now: number; onRead: () => void }) {
  const model = agent.model.effort
    ? `${agent.model.name}, ${agent.model.effort} effort`
    : agent.model.name;
  const facts: [string, React.ReactNode][] = [
    ["Model", model || "Not set"],
    [
      "Acts",
      AUTONOMY[(agent.autonomy.split(/[\s(,]/)[0] ?? "").toLowerCase()] ??
        (sentence(agent.autonomy) || "Not set"),
    ],
    ["Cost", agent.cost ? sentence(agent.cost) : "Not estimated"],
    ["Tells you", agent.sends ? sentence(agent.sends) : "Nothing yet"],
    ["Version", `v${agent.version}${agent.time ? `, ${dayOf(agent.time)}` : ""}`],
  ];
  return (
    <div className="ma-detail" id={`ma-${agent.slug}`}>
      <div className="ma-detail-main">
        {agent.persona.title && (
          <div className="ma-persona">
            <AgentAvatar icon={agent.icon} slug={agent.slug} on={agent.running} size="lg" />
            <div>
              <b>{agent.persona.title}</b>
              {agent.persona.traits && <p className="muted">{sentence(agent.persona.traits)}</p>}
            </div>
          </div>
        )}
        <p className="ma-about">{agent.about || agent.purpose}</p>
        <dl className="ma-facts">
          {(agent.jobs ?? []).length > 0 && (
            <div>
              <dt>Runs on its own</dt>
              <dd>
                <ul className="ma-jobs">
                  {(agent.jobs ?? []).map((j) => (
                    <li key={j.key}>
                      <b>{j.when}</b>, {j.label}.{" "}
                      <span className={j.last?.status === "failed" ? "error-text" : "muted"}>
                        {j.last ? `Last ${dayOf(j.last.at)}: ${j.last.line}` : "Hasn't run yet."}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          {agent.coins.length > 0 && (
            <div>
              <dt>Coins</dt>
              <dd className="ma-coins">
                {agent.coins.map((c) => (
                  <span key={c} className="ma-coin">
                    <CoinIcon coin={c} />
                    {c}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div className="ma-week">
        <h3>Its week</h3>
        <div className="ma-mini">
          <div className="ma-axis" aria-hidden="true">
            {DAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <Track agent={agent} now={now} />
        </div>
        <ol>
          {agent.schedule.map((s) => (
            <li key={s.label} className={agent.next?.label === s.label ? "is-next" : ""}>
              <span className="ma-when num">{timed(s) ? whenOf(s) : "When"}</span>
              <span>{timed(s) ? sentence(s.label) : sentence(s.label.replace(/^when /i, ""))}</span>
            </li>
          ))}
        </ol>
        <button type="button" className="primary" onClick={onRead}>
          Read {agent.slug}.md
        </button>
      </div>
    </div>
  );
}

export default function MyAgents() {
  const [page, setPage] = useState<MyAgentsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reading, setReading] = useState<{
    slug: string;
    markdown: string | null;
    error: string;
  } | null>(null);
  const [now] = useState(() => weekMinute(new Date()));
  const [clock] = useState(() => Date.now());
  const [switching, setSwitching] = useState(false);
  const load = useCallback(() => {
    getMyAgents().then(
      (p) => setPage(p), // every agent starts collapsed; a click opens one
      (e: unknown) => setError(e instanceof Error ? e.message : "Your agents couldn't be read."),
    );
  }, []);
  useEffect(() => load(), [load]);

  const read = useCallback((slug: string) => {
    setReading({ slug, markdown: null, error: "" });
    getMyAgentFile(slug).then(
      (f) => setReading({ slug, markdown: f.error ? null : f.markdown, error: f.error ?? "" }),
      (e: unknown) =>
        setReading({
          slug,
          markdown: null,
          error: e instanceof Error ? e.message : "The file couldn't be read.",
        }),
    );
  }, []);

  if (error && !page) {
    return (
      <div className="ma-state">
        <p className="error-text" role="alert">
          {error}
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!page) {
    return (
      <p className="muted" aria-busy="true">
        Loading your agents…
      </p>
    );
  }

  const agents = page.agents;
  const first = agents
    .flatMap((a) => {
      const n = nextOf(a);
      return n?.auto && a.running ? [{ slug: a.slug, ...n }] : [];
    })
    .sort((a, b) => a.at - b.at)[0];
  const running = agents.filter((a) => a.running).length;
  const scheduled = agents.some((a) => (a.jobs ?? []).length > 0);
  const flip = () => {
    setSwitching(true);
    setAgentsOn(!page.scheduleOn).then(
      () => {
        setSwitching(false);
        load();
      },
      (e: unknown) => {
        setSwitching(false);
        setError(e instanceof Error ? e.message : "That didn't switch.");
      },
    );
  };
  return (
    <section className="ma" aria-label="My agents">
      <p className="ma-said">
        {agents.length === 0 ? (
          "No agents yet."
        ) : (
          <>
            {agents.length} {agents.length === 1 ? "agent" : "agents"},{" "}
            {running === 0
              ? page.scheduleOn === false
                ? "all paused"
                : "none running on its own yet"
              : `${running} running on ${running === 1 ? "its" : "their"} own`}
            .
            {first && (
              <span className="muted">
                {" "}
                Next: {first.slug}, {first.label}, {soonWords(first.at, clock).when}.
              </span>
            )}
          </>
        )}
        {scheduled && (
          <button
            type="button"
            className={`btn btn-small ma-switch${page.scheduleOn ? "" : " btn-accent"}`}
            disabled={switching}
            onClick={flip}
          >
            {page.scheduleOn ? "Pause all agents" : "Switch agents on"}
          </button>
        )}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {agents.length > 0 && (
        <div className="ma-rota">
          <div className="ma-head" aria-hidden="true">
            <span>Agent</span>
            <span>Next</span>
            <span>Last run</span>
            <span>Status</span>
          </div>
          <ul className="ma-list">
            {agents.map((a) => {
              const isOpen = open === a.slug;
              const next = nextOf(a);
              const soon = next ? soonWords(next.at, clock) : null;
              const last = lastOf(a);
              const state = a.running ? "on" : (a.jobs ?? []).length ? "paused" : "hand";
              return (
                <li key={a.slug} className={`ma-row${isOpen ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="ma-line"
                    aria-expanded={isOpen}
                    aria-controls={`ma-${a.slug}`}
                    onClick={() => setOpen(isOpen ? null : a.slug)}
                  >
                    <span className="ma-who">
                      <AgentAvatar icon={a.icon} slug={a.slug} on={a.running} />
                      <b>{a.slug}</b>
                      <small className="muted">{a.persona.title || sentence(a.purpose)}</small>
                    </span>
                    <span className="ma-next">
                      {next && soon ? (
                        <>
                          <b>
                            {sentence(soon.when)}
                            {soon.in && <small className="ma-in"> {soon.in}</small>}
                          </b>
                          <small className="muted">
                            {sentence(next.label)}
                            {next.auto ? "" : ", by hand for now"}
                          </small>
                        </>
                      ) : (
                        <small className="muted">Nothing timed</small>
                      )}
                    </span>
                    <span className="ma-last">
                      {last ? (
                        <>
                          <small className="muted">
                            {sentence(last.label)}, {dayOf(last.at)}
                          </small>
                          <span className={last.status === "failed" ? "error-text" : ""}>
                            {last.line}
                          </span>
                        </>
                      ) : (
                        <small className="muted">
                          {(a.jobs ?? []).length ? "Hasn't run yet" : "Runs when you ask"}
                        </small>
                      )}
                    </span>
                    <span className="ma-meta">
                      <span className={`ma-state is-${state}`}>
                        {state === "on" ? "On" : state === "paused" ? "Paused" : "By hand"}
                      </span>
                      <small className="muted">{a.model.name.replace(/^Claude /, "")}</small>
                    </span>
                  </button>
                  {isOpen && <Detail agent={a} now={now} onRead={() => read(a.slug)} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="muted ma-note">
        To add or change an agent, ask Claude Code to write it in <code>{page.folder}/</code>. Each
        change becomes a new version.
      </p>

      {reading && (
        <Reader
          title={`${reading.slug}.md`}
          meta={`v${agents.find((a) => a.slug === reading.slug)?.version ?? 1}. Read only`}
          markdown={reading.markdown}
          error={reading.error}
          fileName={`${reading.slug}.md`}
          onClose={() => setReading(null)}
          onRetry={() => read(reading.slug)}
        />
      )}
    </section>
  );
}
