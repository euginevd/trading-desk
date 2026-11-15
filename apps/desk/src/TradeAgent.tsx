// The Trade page's centre (TODO 6): the trading agent, before a run, while it works through its
// steps, and its call. Every number on the ticket comes from code; the agent chose the action and
// wrote the words. Its buttons only fill the order sheet; nothing is placed from here.
import { initials } from "./AgentProfile";
import { amount, aud, clock, price } from "./format";
import { OutOfDate } from "./RuleMarks";
import type { AgentPage, AgentRun, PriceAlert, RunStep } from "./types";

const CHIPS = [
  "Should I add before the next rate decision?",
  "Where's my DCA at this month?",
  "What would make you sell?",
];

// Green and red mean buy and sell, amber waiting (design-system 2).
export function actionTone(action: string): "buy" | "sell" | "wait" {
  if (/^(buy|add)/i.test(action)) return "buy";
  if (/^(sell|trim|avoid)/i.test(action)) return "sell";
  return "wait";
}

function seconds(run: AgentRun): string {
  return run.finished ? `${Math.max(1, Math.round((run.finished - run.started) / 1000))}s` : "";
}

export function AgentHero({
  coin,
  agent,
  working,
  onAnalyse,
  onChip,
}: {
  coin: string;
  agent: AgentPage | null;
  working: boolean;
  onAnalyse: () => void;
  onChip: (question: string) => void;
}) {
  const name = agent?.agent.name || "Your agent";
  const on = agent
    ? agent.steps.filter((s) => !s.fixed && agent.agent.steps[s.key].on).map((s) => s.title)
    : [];
  const style = agent ? `${agent.agent.style[0]?.toUpperCase()}${agent.agent.style.slice(1)}` : "";
  return (
    <div className="tr-hero">
      <div className="tr-hero-row">
        <div className="tr-who">
          <span className="tr-ava" aria-hidden="true">
            {initials(name)}
          </span>
          <div>
            <b>{name}</b>
            <small>
              {agent
                ? `Your ${agent.agent.title.toLowerCase() || "trader"} · ${style}`
                : "Your trading agent"}
            </small>
          </div>
        </div>
        <button className="btn btn-accent" type="button" disabled={working} onClick={onAnalyse}>
          {working ? "Starting…" : `Analyse ${coin}`}
        </button>
      </div>
      <p>
        {name} reads your Profile (goals, rules and holdings) and your {coin} position, then works
        through {on.length ? on.join(", ").toLowerCase() : "the steps you've switched on"}, and
        checks the result against your rules before proposing an order.
        {agent && ` About $${agent.estimate} a run.`}
      </p>
      <div className="tr-chips">
        {CHIPS.map((q) => (
          <button key={q} type="button" className="tr-chip" onClick={() => onChip(q)}>
            {q}
          </button>
        ))}
      </div>
      <p className="tr-fine dim">
        Pick a question to ask once the run is done. {name} advises; you place every order.{" "}
        <a href="#/profile?tab=agent">Change how {name} works</a>
      </p>
    </div>
  );
}

export function RunHeader({
  run,
  working,
  onAnalyse,
  onContinue,
}: {
  run: AgentRun;
  working: boolean;
  onAnalyse: () => void;
  onContinue: () => void;
}) {
  const total = run.steps.length;
  const at = run.steps.findIndex((s) => s.status === "pending");
  const failed = run.steps.findIndex((s) => s.status === "failed");
  const step = at < 0 ? total : at + 1;
  // A run found part way is paused: only a press spends on it.
  const paused = run.status === "running" && !working;
  const line = paused
    ? `Paused at step ${step} of ${total}`
    : run.status === "running"
      ? `Working on ${run.coin} · step ${step} of ${total}`
      : run.status === "stopped"
        ? `Stopped at step ${(failed < 0 ? Math.max(at, 0) : failed) + 1} of ${total}`
        : `Analysed ${run.coin} at ${clock(run.finished ?? run.started)} · ${seconds(run)} · $${run.cost}`;
  return (
    <div className="tr-run-head">
      <div className="tr-who">
        <span className="tr-ava" aria-hidden="true">
          {initials(run.agent.name)}
        </span>
        <div>
          <b>{run.agent.name}</b>
          <small role="status">{line}</small>
        </div>
      </div>
      {paused ? (
        <div className="tr-run-btns">
          <button className="btn btn-accent btn-small" type="button" onClick={onContinue}>
            Continue
          </button>
          <button className="btn btn-small" type="button" onClick={onAnalyse}>
            Start over
          </button>
        </div>
      ) : (
        run.status !== "running" && (
          <button className="btn btn-small" type="button" disabled={working} onClick={onAnalyse}>
            Analyse {run.coin} again
          </button>
        )
      )}
    </div>
  );
}

type StepState = "done" | "now" | "pending" | "skipped" | "failed";
const MARK: Record<StepState, string> = {
  done: "✓",
  now: "",
  pending: "",
  skipped: "–",
  failed: "!",
};
const WORD: Record<StepState, string> = {
  done: "Done",
  now: "Working",
  pending: "Waiting",
  skipped: "Skipped",
  failed: "Not run",
};

function meta(step: RunStep, state: StepState): string {
  if (state === "done") {
    const who = step.model ?? "code";
    return Number(step.cost) > 0 ? `${who} · $${step.cost}` : who;
  }
  if (state === "now") return "Working…";
  if (state === "skipped") return "Off";
  if (state === "failed") return "Not run";
  return "";
}

export function Timeline({ run, working }: { run: AgentRun; working: boolean }) {
  const now =
    run.status === "running" && working ? run.steps.findIndex((s) => s.status === "pending") : -1;
  return (
    <ol className="tr-steps" aria-label="Steps">
      {run.steps.map((step, i) => {
        const state: StepState = i === now ? "now" : step.status;
        return (
          <li key={step.key} className={`tr-step ${state}`}>
            <span className="tr-dot" aria-hidden="true">
              {state === "pending" ? i + 1 : MARK[state]}
            </span>
            <h3>
              <span className="visually-hidden">{WORD[state]}: </span>
              {step.title} <span>· {step.who}</span>
            </h3>
            <span className="tr-meta">{meta(step, state)}</span>
            {state === "now" && (
              <div className="tr-bar-run" role="progressbar" aria-label={`${step.title} running`}>
                <i />
              </div>
            )}
            {step.summary && state !== "pending" && <p>{step.summary}</p>}
            {step.points.length > 0 && (
              <ul>
                {step.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {step.events.length > 0 && (
              <ul className="tr-events" aria-label="Coming up">
                {step.events.map((e) => (
                  <li key={`${e.when}-${e.what}`}>
                    <b>{e.when}</b> {e.what}
                  </li>
                ))}
              </ul>
            )}
            {step.note && (
              <p className={state === "failed" ? "tr-step-note wait" : "tr-step-note"}>
                {step.note}
                {state === "failed" && (
                  <>
                    {" "}
                    <a href="#/settings">Open Settings</a>
                  </>
                )}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function WatchFor({
  run,
  alerts,
  onSetAlert,
}: {
  run: AgentRun;
  alerts: PriceAlert[];
  onSetAlert: (w: { price: string; direction: "above" | "below"; note: string }) => void;
}) {
  const lines = run.signal?.watchFor ?? [];
  if (lines.length === 0) return null;
  const set = (w: { price: string; direction: string }) =>
    alerts.some(
      (a) =>
        Number(a.price) === Number(w.price) && a.direction === w.direction && a.triggered === null,
    );
  return (
    <div className="tr-watch">
      <h3>Watch for</h3>
      <ul>
        {lines.map((w) => (
          <li key={`${w.direction}-${w.price}`}>
            <span>
              {w.direction === "above" ? "Above" : "Below"} <b className="num">{price(w.price)}</b>{" "}
              <span className="muted">{w.note}</span>
            </span>
            {set(w) ? (
              <span className="muted">Alert set</span>
            ) : (
              <button
                className="link"
                type="button"
                aria-label={`Set alert ${w.direction} ${price(w.price)}`}
                onClick={() => onSetAlert(w)}
              >
                Set alert
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function withinLine(run: AgentRun): string {
  const g = run.guardrails;
  const parts = [
    g.perTradeAud && `per trade ${aud(g.perTradeAud)}`,
    g.capAud && `cap left ${aud(String(Number(g.capAud) - Number(g.monthSpentAud)))}`,
    g.maxPctPerCoin && `max per coin ${g.maxPctPerCoin}%`,
  ].filter(Boolean);
  return parts.length ? `Within your Profile: ${parts.join(", ")}` : "Within your Profile";
}

export function TicketCard({
  run,
  busy,
  alerts,
  onUse,
  onEdit,
  onDismiss,
  onSetAlert,
}: {
  run: AgentRun;
  busy: boolean;
  alerts: PriceAlert[];
  onUse: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onSetAlert: (w: { price: string; direction: "above" | "below"; note: string }) => void;
}) {
  const signal = run.signal;
  if (!signal) return null;
  const ticket = run.ticket;
  const name = run.agent.name;
  const action = signal.action ?? signal.verdict;
  const tone = actionTone(action);
  const model = run.steps.find((s) => s.key === "decision")?.model;
  const inv = signal.zones?.invalidation;
  const why = signal.why;
  return (
    <article className="tr-ticket" aria-label={`${name}'s call`}>
      <div className="tr-ticket-head">
        <div>
          <div className="tr-stamp">
            Decision · {name}
            {model && ` · ${model}`}
          </div>
          <div
            className={`tr-verdict ${tone === "buy" ? "up" : tone === "sell" ? "down" : "wait"}`}
          >
            {action}
          </div>
          {run.outOfDate && <OutOfDate because="your Profile or agent changed" />}
        </div>
        <div className="tr-conf">
          <b className="num">{signal.confidence}%</b>
          <div className="tr-stamp">
            confidence
            {signal.confidenceBefore != null && ` · was ${signal.confidenceBefore}%`}
          </div>
        </div>
      </div>
      <div
        className="tr-meter"
        role="progressbar"
        aria-label="Confidence"
        aria-valuenow={signal.confidence}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${Math.max(0, Math.min(100, signal.confidence))}%` }} />
      </div>
      {signal.summary && <p className="tr-summary">{signal.summary}</p>}
      {ticket ? (
        <dl className="tr-order">
          <div>
            <dt>Order</dt>
            <dd className={ticket.side === "buy" ? "up" : "down"}>
              Limit {ticket.side === "buy" ? "buy" : "sell"}
            </dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd className="num">
              {aud(ticket.totalAud)} · {amount(ticket.qty)} {run.coin}
            </dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd className="num">{price(ticket.price)}</dd>
          </div>
          <div>
            <dt>Invalidation</dt>
            <dd className="num">{inv ? `Daily close under ${price(inv.price)}` : "–"}</dd>
          </div>
        </dl>
      ) : (
        <p className="tr-noticket">{run.noTicket ?? "No order this time."}</p>
      )}
      {why ? (
        <ul className="tr-why">
          <li>
            <i className="up" aria-label="For">
              +
            </i>
            {why.bull}
          </li>
          <li>
            <i className="down" aria-label="Against">
              −
            </i>
            {why.bear}
          </li>
          <li>
            <i className="muted" aria-label="What would change the call">
              ?
            </i>
            {why.changeMind}
          </li>
        </ul>
      ) : (
        signal.reasons.length > 0 && (
          <ul className="tr-why">
            {signal.reasons.map((r) => (
              <li key={r}>
                <i className="muted" aria-hidden="true">
                  ·
                </i>
                {r}
              </li>
            ))}
          </ul>
        )
      )}
      <WatchFor run={run} alerts={alerts} onSetAlert={onSetAlert} />
      {ticket &&
        (ticket.breaks.length === 0 ? (
          ticket.side === "sell" ? (
            <p className="tr-check plain">Sells don&apos;t count against your buy rules.</p>
          ) : (
            <div className="tr-check ok">
              <span aria-hidden="true">✓</span> {withinLine(run)}
            </div>
          )
        ) : (
          <div className="tr-check bad" role="note">
            <b>
              <span aria-hidden="true">!</span>{" "}
              {ticket.breaks.length > 1
                ? `Breaks ${ticket.breaks.length} of your rules`
                : "Breaks one of your rules"}
            </b>
            <ul>
              {ticket.breaks.map((b) => (
                <li key={`${b.rule}-${b.message}`}>
                  {b.label}: {b.message}
                </li>
              ))}
            </ul>
          </div>
        ))}
      <div className="tr-ticket-foot">
        {ticket && run.choice !== "dismissed" && (
          <>
            <button className="btn btn-accent" type="button" disabled={busy} onClick={onUse}>
              Use this order
            </button>
            <button className="btn" type="button" disabled={busy} onClick={onEdit}>
              Edit
            </button>
            <button className="btn tr-ghost" type="button" disabled={busy} onClick={onDismiss}>
              Dismiss
            </button>
          </>
        )}
        {run.choice && (
          <span className="tr-choice">
            {run.choice === "used"
              ? "You used this order"
              : run.choice === "edited"
                ? "You edited this order"
                : "Dismissed, logged"}
          </span>
        )}
        <span className="tr-stamp tr-stamp-end">
          Agent v{run.agentVersion} · Profile v{run.profileVersion}
        </span>
      </div>
    </article>
  );
}

export function Asks({ run }: { run: AgentRun }) {
  if (run.asks.length === 0) return null;
  return (
    <div className="tr-asks" aria-label={`Questions for ${run.agent.name}`}>
      {run.asks.map((a, i) => (
        <div key={`${i}-${a.q}`} className="tr-qa">
          <div className="tr-bubble me">
            <span className="visually-hidden">You asked: </span>
            {a.q}
          </div>
          <div className="tr-answer">
            <span className="tr-ava tr-ava-sm" aria-hidden="true">
              {initials(run.agent.name)}
            </span>
            <div className="tr-bubble">
              <span className="visually-hidden">{run.agent.name}: </span>
              {a.a}
            </div>
          </div>
        </div>
      ))}
      <p className="tr-fine dim">AI answers from this run, advice only. Nothing was changed.</p>
    </div>
  );
}
