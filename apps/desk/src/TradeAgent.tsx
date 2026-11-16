// The Trade page's centre (TODO 6): the trading agent, before a run, while it works through its
// steps, and its call. Every number on the ticket comes from code; the agent chose the action and
// wrote the words. Its buttons only fill the order sheet; nothing is placed from here.
import { useState } from "react";
import { initials } from "./AgentProfile";
import { amount, aud, big, clock, price } from "./format";
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
      <p className="tr-hero-line">
        {name} reads your plan, your {coin} position and the market, then proposes one order.
        {agent && ` About $${agent.estimate} a run.`}
      </p>
      <div className="tr-chips">
        {CHIPS.map((q) => (
          <button key={q} type="button" className="tr-chip" onClick={() => onChip(q)}>
            {q}
          </button>
        ))}
      </div>
      <a className="tr-fine" href="#/profile?tab=agent">
        Change how {name} works
      </a>
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
  const done = run.status === "done"; // a stopped run stays open: its failure is what to read
  const [open, setOpen] = useState(false);
  const cost = run.steps.reduce((t, x) => t + Number(x.cost ?? 0), 0);
  if (done && !open)
    return (
      <button
        type="button"
        className="tr-fold tr-how-fold"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        How {run.agent.name} got there{" "}
        <span className="muted">
          · {run.steps.length} steps{cost > 0 ? ` · $${cost.toFixed(3)}` : ""}
        </span>
      </button>
    );
  return (
    <div className="tr-how">
      {done && (
        <button
          type="button"
          className="tr-fold tr-how-fold"
          aria-expanded
          onClick={() => setOpen(false)}
        >
          How {run.agent.name} got there{" "}
          <span className="muted">
            · {run.steps.length} steps{cost > 0 ? ` · $${cost.toFixed(3)}` : ""}
          </span>
        </button>
      )}
      <ol className="tr-steps" aria-label="Steps">
        {run.steps.map((step, i) => (
          <Step
            key={step.key}
            step={step}
            n={i + 1}
            state={i === now ? "now" : step.status}
            folds={done}
          />
        ))}
      </ol>
    </div>
  );
}

// A step: its title, who ran it and what it cost; once the run is done, its first line only,
// opening to the rest on a click.
function Step({
  step,
  n,
  state,
  folds,
}: {
  step: RunStep;
  n: number;
  state: StepState;
  folds: boolean;
}) {
  const [open, setOpen] = useState(false);
  const more = step.points.length > 0 || step.events.length > 0 || Boolean(step.note);
  const shut = folds && !open && state !== "failed" && (more || Boolean(step.summary));
  return (
    <li className={`tr-step ${state}${shut ? " shut" : ""}`}>
      <span className="tr-dot" aria-hidden="true">
        {state === "pending" ? n : MARK[state]}
      </span>
      <h3>
        {folds && state !== "failed" && (more || step.summary) ? (
          <button
            type="button"
            className="tr-step-toggle"
            aria-expanded={!shut}
            onClick={() => setOpen(!open)}
          >
            <span className="visually-hidden">{WORD[state]}: </span>
            {step.title} <span>· {step.who}</span>
          </button>
        ) : (
          <>
            <span className="visually-hidden">{WORD[state]}: </span>
            {step.title} <span>· {step.who}</span>
          </>
        )}
      </h3>
      <span className="tr-meta">{meta(step, state)}</span>
      {state === "now" && (
        <div className="tr-bar-run" role="progressbar" aria-label={`${step.title} running`}>
          <i />
        </div>
      )}
      {step.summary && state !== "pending" && <p className="tr-step-sum">{step.summary}</p>}
      {!shut && step.points.length > 0 && (
        <ul>
          {step.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {!shut && step.events.length > 0 && (
        <ul className="tr-events" aria-label="Coming up">
          {step.events.map((e) => (
            <li key={`${e.when}-${e.what}`}>
              <b>{e.when}</b> {e.what}
            </li>
          ))}
        </ul>
      )}
      {(!shut || !step.summary) && step.note && (
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
  const [why, setWhy] = useState(false);
  const signal = run.signal;
  if (!signal) return null;
  const ticket = run.ticket;
  const name = run.agent.name;
  const action = signal.action ?? signal.verdict;
  const tone = actionTone(action);
  const model = run.steps.find((s) => s.key === "decision")?.model;
  const inv = signal.zones?.invalidation;
  const reasons = signal.why
    ? [
        { mark: "+", tone: "up", label: "For", text: signal.why.bull },
        { mark: "−", tone: "down", label: "Against", text: signal.why.bear },
        {
          mark: "?",
          tone: "muted",
          label: "What would change the call",
          text: signal.why.changeMind,
        },
      ]
    : signal.reasons.map((r) => ({ mark: "·", tone: "muted", label: "", text: r }));
  const watch = run.signal?.watchFor ?? [];
  const isSet = (w: { price: string; direction: string }) =>
    alerts.some(
      (a) =>
        Number(a.price) === Number(w.price) && a.direction === w.direction && a.triggered === null,
    );
  return (
    <article
      className="tr-decision"
      aria-label={`${name}'s call`}
      title={`${name}${model ? ` on ${model}` : ""} · Agent v${run.agentVersion} · Profile v${run.profileVersion}`}
    >
      {/* The call in one line: what, how sure, and whether it still stands. */}
      <div className="tr-decision-head">
        <span className={`tr-verdict ${tone === "buy" ? "up" : tone === "sell" ? "down" : "wait"}`}>
          {action}
        </span>
        <span className="tr-conf num">
          {signal.confidence}% sure
          {signal.confidenceBefore != null && (
            <small className="muted"> was {signal.confidenceBefore}%</small>
          )}
        </span>
        {run.outOfDate && <OutOfDate because="your Profile or agent changed" />}
        <span className="spacer" />
        {run.choice && (
          <span className="tr-choice">
            {run.choice === "used"
              ? "You used this order"
              : run.choice === "edited"
                ? "You edited this order"
                : "Dismissed, logged"}
          </span>
        )}
      </div>
      {signal.summary && <p className="tr-do">{signal.summary}</p>}

      {/* The order, if there is one: one line and three buttons. */}
      {ticket ? (
        <div className="tr-order-line">
          <span className="tr-order-what num">
            <b className={ticket.side === "buy" ? "up" : "down"}>
              Limit {ticket.side === "buy" ? "buy" : "sell"}
            </b>{" "}
            {amount(ticket.qty)} {run.coin} at <b>{big(ticket.price)}</b>{" "}
            <span className="muted">{aud(ticket.totalAud)}</span>
            {inv && <small className="muted">Out on a daily close under {big(inv.price)}</small>}
          </span>
          {run.choice !== "dismissed" && (
            <span className="tr-order-btns">
              <button className="btn btn-accent" type="button" disabled={busy} onClick={onUse}>
                Use this order
              </button>
              <button className="btn" type="button" disabled={busy} onClick={onEdit}>
                Edit
              </button>
              <button className="btn tr-ghost" type="button" disabled={busy} onClick={onDismiss}>
                Dismiss
              </button>
            </span>
          )}
        </div>
      ) : (
        <p className="tr-noorder muted">{run.noTicket ?? "No order this time."}</p>
      )}

      {ticket &&
        (ticket.breaks.length === 0 ? (
          ticket.side === "sell" ? (
            <p className="tr-check plain">Sells don&apos;t count against your buy rules.</p>
          ) : (
            <p className="tr-check ok">
              <span aria-hidden="true">✓</span> {withinLine(run)}
            </p>
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

      {/* Prices worth an alert, each one click. */}
      {watch.length > 0 && (
        <div className="tr-watch" aria-label="Watch for">
          {watch.map((w) => (
            <span key={`${w.direction}-${w.price}`} className="tr-watch-chip" title={w.note}>
              {w.direction === "above" ? "Above" : "Below"} <b className="num">{big(w.price)}</b>
              {isSet(w) ? (
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
            </span>
          ))}
        </div>
      )}

      {reasons.length > 0 && (
        <div className="tr-why-box">
          <button
            type="button"
            className="tr-fold"
            aria-expanded={why}
            onClick={() => setWhy(!why)}
          >
            Why
          </button>
          {why && (
            <ul className="tr-why">
              {reasons.map((r) => (
                <li key={r.text}>
                  <i className={r.tone} aria-label={r.label || undefined} aria-hidden={!r.label}>
                    {r.mark}
                  </i>
                  {r.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
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
