// My agents (TODO 10): agents named by purpose, one file each in local/agents/. The page is a
// week rota, one row per agent with a dot for each time it wakes, so ten agents still read at a
// glance; opening a row gives its few facts, its week in words, and the file itself.
import { useCallback, useEffect, useState } from "react";
import { getMyAgentFile, getMyAgents } from "./api";
import CoinIcon from "./CoinIcon";
import { Reader } from "./Markdown";
import { dayOf } from "./profileFields";
import type { MyAgent, MyAgentSlot, MyAgentsPage } from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
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

function nextWords(agent: MyAgent): string | null {
  if (!agent.next) return null;
  const at = new Date(agent.next.at);
  const slot = agent.schedule.find(
    (s) => timed(s) && s.label === agent.next?.label && s.day === (at.getDay() + 6) % 7,
  );
  const when = slot && timed(slot) ? `${LONG[slot.day]} ${clockOf(slot.minute)}` : "";
  return `${agent.next.label}${when ? `, ${when}` : ""}`;
}

function Track({ agent, now }: { agent: MyAgent; now: number }) {
  const slots = agent.schedule.filter(timed);
  return (
    <div className="ma-track" aria-hidden="true">
      {DAYS.map((d) => (
        <span key={d} className="ma-day" />
      ))}
      <span className="ma-now" style={{ left: `${(now / WEEK) * 100}%` }} />
      {slots.map((s) => {
        const next = agent.next?.label === s.label;
        return (
          <span
            key={`${s.day}-${s.minute}`}
            className={`ma-dot${next ? " is-next" : ""}`}
            style={{ left: `${((s.day * 1440 + s.minute) / WEEK) * 100}%` }}
            title={`${DAYS[s.day]} ${clockOf(s.minute)}: ${s.label}`}
          />
        );
      })}
    </div>
  );
}

function Detail({ agent, onRead }: { agent: MyAgent; onRead: () => void }) {
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
        <p className="ma-about">{agent.about || agent.purpose}</p>
        <dl className="ma-facts">
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
        <ol>
          {agent.schedule.map((s) => (
            <li key={s.label} className={agent.next?.label === s.label ? "is-next" : ""}>
              <span className="ma-when num">
                {timed(s) ? `${DAYS[s.day]} ${clockOf(s.minute)}` : "When"}
              </span>
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
  const load = useCallback(() => {
    getMyAgents().then(
      (p) => {
        setPage(p);
        setOpen((o) => o ?? p.agents[0]?.slug ?? null);
      },
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
  const first = agents.find((a) => a.next);
  const running = agents.filter((a) => a.running).length;
  return (
    <section className="ma" aria-label="My agents">
      <p className="ma-said">
        {agents.length === 0 ? (
          "No agents yet."
        ) : (
          <>
            {agents.length} {agents.length === 1 ? "agent" : "agents"} on your desk,{" "}
            {running === 0 ? "none switched on yet" : `${running} switched on`}.
            {first && (
              <span className="muted">
                {" "}
                Next up: {first.slug}, {nextWords(first)}.
              </span>
            )}
          </>
        )}
      </p>

      {agents.length > 0 && (
        <div className="ma-rota">
          <div className="ma-head" aria-hidden="true">
            <span />
            <div className="ma-axis">
              {DAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <span />
          </div>
          <ul className="ma-list">
            {agents.map((a) => {
              const isOpen = open === a.slug;
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
                      <span
                        className={`ma-state-dot${a.running ? " on" : ""}`}
                        aria-hidden="true"
                      />
                      <b>{a.slug}</b>
                      <small className="muted">{sentence(a.purpose)}</small>
                    </span>
                    <Track agent={a} now={now} />
                    <span className="ma-meta">
                      <span>{a.model.name.replace(/^Claude /, "")}</span>
                      <small className="muted">{a.running ? "On" : "Not running yet"}</small>
                    </span>
                  </button>
                  {isOpen && <Detail agent={a} onRead={() => read(a.slug)} />}
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
