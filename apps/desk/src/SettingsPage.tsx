// Settings (decisions 50, 51, 65 and 85): how the desk connects and behaves, said in a sentence, then
// how it answers (Claude), the morning summary (Telegram) and which pages show, as hairline sections. Sign in or
// paste a key here, as in Claude Code; the api saves it to .env and this page only ever shows
// whether each is set. Your name lives in the Profile.
import { type ReactNode, useEffect, useState } from "react";
import {
  finishSignIn,
  getLedger,
  getAiSettings,
  getSettings,
  getTelegram,
  linkTelegram,
  saveTelegramToken,
  setTelegramTime,
  testTelegram,
  saveAiKey,
  setAiSettings,
  setLimits,
  startSignIn,
} from "./api";
import { day, errorOf } from "./format";
import { FEATURES, type FeatureInfo, featureOn, isNew, useFeatures } from "./features";
import type {
  AiMode,
  AiSettings,
  AppUsage,
  LedgerView,
  PlanWindow,
  Settings,
  SubscriptionUsage,
  TelegramSettings,
} from "./types";

const MODES: Record<AiMode, { name: string; title: string; sub: string }> = {
  api_key: { name: "API key (pay per use)", title: "API key", sub: "Pay per use" },
  subscription: {
    name: "Claude subscription (personal use)",
    title: "Claude subscription",
    sub: "Pro or Max plan, personal use",
  },
};

// One line per model, matched on its family so a new version keeps its note.
const MODEL_NOTES: [string, string][] = [
  ["Opus", "The deepest reasoning"],
  ["Sonnet", "About half Opus's price"],
  ["Haiku", "The cheapest and fastest"],
];
const modelNote = (name: string) => MODEL_NOTES.find(([family]) => name.includes(family))?.[1];
const shortName = (name: string) => name.replace("Claude ", "");
// Effort, as Claude Code offers it: one level for whichever model is chosen.
const EFFORT_NAMES: Record<string, [string, string]> = {
  low: ["Low", "Quickest and cheapest; fine for routine answers"],
  medium: ["Medium", "The default: a balance of depth, speed and cost"],
  high: ["High", "Thinks harder; slower and costs more"],
  xhigh: ["Extra high", "For hard calls; slower again"],
  max: ["Max", "The deepest thinking; slowest and most expensive"],
};

type Tone = "up" | "wait" | "down" | "idle";

/** "09:30" as the desk writes times (design-system 18): "9:30 am". */
export function amPm(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

// A status is a word with a dot (design-system 22, code-standards 26), never the colour alone.
function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`settings-status is-${tone}`}>
      <span className="settings-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

// Every card's header: its title, and its status at the right.
function CardHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <header className="settings-head">
      <h2 id={id}>{title}</h2>
      {children}
    </header>
  );
}

// Whether the AI can answer right now, on what it's set to.
function aiStatus(ai: AiSettings): { tone: Tone; word: string } {
  if (ai.mode === "api_key") {
    return ai.apiKeySet ? { tone: "up", word: "Ready" } : { tone: "down", word: "Not set up" };
  }
  if (ai.tokenSet) return { tone: "up", word: "Ready" };
  if (ai.fallback && ai.apiKeySet) return { tone: "wait", word: "On the API key" };
  return { tone: "down", word: "Not set up" };
}

// What the desk runs on, in a sentence: the provider and model, this month's spend or the fall
// back, and whether the morning summary goes out. The one place the spend is shown.
function Said({ ai, tg }: { ai: AiSettings | null; tg: TelegramSettings | null }) {
  if (!ai) return null;
  const model = ai.models.find((m) => m.id === ai.model);
  const name = model ? shortName(model.name) : ai.model;
  const on = ai.mode === "api_key" ? "your API key" : "your Claude subscription";
  let detail: string;
  if (ai.mode === "api_key") {
    detail = ai.apiKeySet
      ? `$${Number(ai.budget.spent).toFixed(2)} of $${ai.budget.cap} spent this month.`
      : "Paste a key below to start.";
  } else if (!ai.tokenSet) {
    detail =
      ai.fallback && ai.apiKeySet
        ? "You're not signed in, so the API key answers."
        : "Sign in below to start.";
  } else if (!ai.fallback) {
    detail = "No fall back to the API key.";
  } else {
    detail = ai.apiKeySet
      ? "The API key answers if the subscription fails."
      : "Fall back is on, but there's no API key yet.";
  }
  const summary = !tg
    ? ""
    : !tg.tokenSet
      ? "No morning summary yet."
      : tg.chatFound
        ? `Your summary goes to Telegram at ${amPm(tg.time)}.`
        : "Telegram is waiting for you to link your chat.";
  return (
    <section className="set-hero" aria-label="What the desk runs on">
      <h2 className="set-headline">
        The desk answers with {name} on {on}.
      </h2>
      <p className="set-lead">
        {detail} {summary}
      </p>
    </section>
  );
}

export default function SettingsPage() {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tg, setTg] = useState<TelegramSettings | null>(null);

  useEffect(() => {
    getAiSettings().then(setAi, (e: unknown) => setError(errorOf(e, "Settings couldn't be read.")));
  }, [attempt]);

  // Every change goes through here: one at a time, with the reply as the new state.
  const run = (action: () => Promise<AiSettings>, failed: string) => {
    setSaving(true);
    setError(null);
    return action().then(
      (next) => {
        setAi(next);
        setSaving(false);
        return true;
      },
      (e: unknown) => {
        setError(errorOf(e, failed));
        setSaving(false);
        return false;
      },
    );
  };
  const pick = (mode: AiMode) => {
    if (ai && ai.mode !== mode) {
      void run(() => setAiSettings(mode, ai.fallback, ai.model), "Not saved.");
    }
  };
  const status = ai && aiStatus(ai);

  return (
    <main className="wrap settings">
      <Said ai={ai} tg={tg} />
      {/* Two columns that stack their own cards, so a short card leaves no gap beside a tall one. */}
      <div className="set-col">
        <section className="set-section" aria-labelledby="settings-ai">
          <CardHead id="settings-ai" title="How the desk answers">
            {status && <Status tone={status.tone}>{status.word}</Status>}
          </CardHead>
          {!ai && !error && (
            <p className="muted settings-loading" aria-busy="true">
              Loading…
            </p>
          )}
          {error && (
            <div className="settings-error-row">
              <p className="settings-error" role="alert">
                {error}
              </p>
              {!ai && (
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => {
                    setError(null);
                    setAttempt((n) => n + 1);
                  }}
                >
                  Try again
                </button>
              )}
            </div>
          )}
          {ai && (
            <>
              <fieldset className="settings-group">
                <legend className="settings-label">Answer with</legend>
                <div className="settings-providers">
                  <ApiKey ai={ai} saving={saving} run={run} onPick={() => pick("api_key")} />
                  <Subscription
                    ai={ai}
                    saving={saving}
                    run={run}
                    onError={setError}
                    onPick={() => pick("subscription")}
                  />
                </div>
              </fieldset>
              <fieldset className="settings-group">
                <legend className="settings-label">Model</legend>
                <div className="settings-models">
                  {ai.models.map((m) => {
                    const on = ai.model === m.id;
                    const note = modelNote(m.name);
                    return (
                      <label key={m.id} className={`settings-option${on ? " on" : ""}`}>
                        <input
                          type="radio"
                          name="ai-model"
                          value={m.id}
                          checked={on}
                          disabled={saving}
                          aria-label={shortName(m.name)}
                          aria-describedby={note ? `model-${m.id}` : undefined}
                          onChange={() =>
                            void run(() => setAiSettings(ai.mode, ai.fallback, m.id), "Not saved.")
                          }
                        />
                        <span className="settings-option-text">
                          <strong>{shortName(m.name)}</strong>
                          {note && (
                            <span className="muted" id={`model-${m.id}`}>
                              {note}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="settings-group">
                <legend className="settings-label">Effort</legend>
                <div className="views settings-efforts" role="radiogroup" aria-label="Effort">
                  {ai.efforts.map((level) => (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={ai.effort === level}
                      disabled={saving}
                      onClick={() =>
                        ai.effort !== level &&
                        void run(
                          () => setAiSettings(ai.mode, ai.fallback, ai.model, level),
                          "Not saved.",
                        )
                      }
                    >
                      {EFFORT_NAMES[level]?.[0] ?? level}
                    </button>
                  ))}
                </div>
                <p className="settings-hint muted">{EFFORT_NAMES[ai.effort]?.[1]}</p>
              </fieldset>
              <p className="settings-note muted">
                Applies to every AI feature: the coach, the desk&apos;s agents, Analyse and the
                Profile&apos;s command bar. What you enter is saved to .env and never shown again.
              </p>
            </>
          )}
        </section>
        <Ledger />
      </div>
      <div className="set-col">
        <Limits />
        <Telegram onRead={setTg} />
      </div>
      <Pages />
    </main>
  );
}

type Run = (action: () => Promise<AiSettings>, failed: string) => Promise<boolean>;

// A provider as a selectable card: a native radio (arrow keys move between the two), its own
// status and its own action. The one in use is ringed in the accent and tagged In use.
function ProviderCard({
  mode,
  ai,
  saving,
  onPick,
  status,
  action,
  children,
}: {
  mode: AiMode;
  ai: AiSettings;
  saving: boolean;
  onPick: () => void;
  status: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const option = MODES[mode];
  const on = ai.mode === mode;
  return (
    <div className={`settings-provider${on ? " on" : ""}`}>
      <div className="settings-provider-head">
        <label className="settings-option-pick">
          <input
            type="radio"
            name="ai-mode"
            value={mode}
            checked={on}
            disabled={saving}
            aria-label={option.name}
            onChange={onPick}
          />
          <span className="settings-option-text">
            <strong>{option.title}</strong>
            <span className="muted">{option.sub}</span>
          </span>
        </label>
        {on && <span className="settings-tag">In use</span>}
      </div>
      <div className="settings-provider-state">
        {status}
        {action}
      </div>
      {children}
    </div>
  );
}

function ApiKey({
  ai,
  saving,
  run,
  onPick,
}: {
  ai: AiSettings;
  saving: boolean;
  run: Run;
  onPick: () => void;
}) {
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const editing = !ai.apiKeySet || open;
  const save = () =>
    void run(() => saveAiKey(key), "The key wasn't saved.").then((ok) => {
      if (ok) {
        setKey("");
        setOpen(false);
      }
    });
  return (
    <ProviderCard
      mode="api_key"
      ai={ai}
      saving={saving}
      onPick={onPick}
      status={
        ai.apiKeySet ? <Status tone="up">Key set</Status> : <Status tone="idle">No key yet</Status>
      }
      action={
        ai.apiKeySet && !open ? (
          <button className="link" type="button" onClick={() => setOpen(true)}>
            Replace
          </button>
        ) : undefined
      }
    >
      {editing && (
        <div className="settings-input">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-api03-…"
            aria-label="Anthropic API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            type="button"
            className="settings-btn"
            disabled={saving || !key.trim()}
            onClick={save}
          >
            Save key
          </button>
          {open && (
            <button
              className="link"
              type="button"
              onClick={() => {
                setOpen(false);
                setKey("");
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
      <p className="settings-hint muted">
        Create a key at console.anthropic.com under API keys, then paste it here.
      </p>
      {ai.apiKeySet && <ApiUsage ai={ai} />}
    </ProviderCard>
  );
}

function Subscription({
  ai,
  saving,
  run,
  onError,
  onPick,
}: {
  ai: AiSettings;
  saving: boolean;
  run: Run;
  onError: (error: string | null) => void;
  onPick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);

  const start = () => {
    setStarting(true);
    onError(null);
    startSignIn().then(
      (reply) => {
        setUrl(reply.url);
        setStarting(false);
        window.open(reply.url, "_blank", "noopener,noreferrer");
      },
      (e: unknown) => {
        onError(errorOf(e, "The sign-in didn't start."));
        setStarting(false);
      },
    );
  };
  const finish = () =>
    void run(() => finishSignIn(code), "The sign-in didn't finish.").then((ok) => {
      if (ok) {
        setUrl(null);
        setCode("");
      }
    });

  return (
    <ProviderCard
      mode="subscription"
      ai={ai}
      saving={saving}
      onPick={onPick}
      status={
        ai.tokenSet ? (
          <Status tone="up">Signed in</Status>
        ) : (
          <Status tone="idle">Not signed in</Status>
        )
      }
      action={
        url ? undefined : (
          <button
            className={ai.tokenSet ? "link" : "settings-btn primary"}
            type="button"
            disabled={starting || saving}
            onClick={start}
          >
            {starting ? "Starting…" : ai.tokenSet ? "Sign in again" : "Sign in with Claude"}
          </button>
        )
      }
    >
      {url && (
        <div className="settings-signin">
          <p>
            Approve the desk on claude.ai (
            <a href={url} target="_blank" rel="noopener noreferrer">
              open it again
            </a>
            ), then paste the code it shows:
          </p>
          <div className="settings-input">
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              aria-label="Code from claude.ai"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              type="button"
              className="settings-btn"
              disabled={saving || !code.trim()}
              onClick={finish}
            >
              {saving ? "Signing in…" : "Finish sign-in"}
            </button>
            <button className="link" type="button" onClick={() => setUrl(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {ai.mode === "subscription" && (
        <label className="settings-check">
          <input
            type="checkbox"
            checked={ai.fallback}
            disabled={saving}
            onChange={(e) =>
              void run(() => setAiSettings(ai.mode, e.target.checked, ai.model), "Not saved.")
            }
          />
          Use the API key if the subscription fails
        </label>
      )}
      <p className="settings-hint muted">
        Signs in the way Claude Code does; the token lasts a year.
      </p>
      {ai.tokenSet && ai.usage && <Usage usage={ai.usage} />}
    </ProviderCard>
  );
}

// "3 pm" or "11:30 am" today, "Fri 11 pm" another day: when a plan window resets, or was read.
function at(ms: number): string {
  const time = new Date(ms);
  const h = time.getHours();
  const m = time.getMinutes();
  const mins = m ? `:${String(m).padStart(2, "0")}` : "";
  const clock = `${h % 12 || 12}${mins} ${h < 12 ? "am" : "pm"}`;
  if (time.toDateString() === new Date().toDateString()) return clock;
  return `${time.toLocaleDateString("en-AU", { weekday: "short" })} ${clock}`;
}
const tokenCount = (n: number) =>
  n.toLocaleString("en-AU", { notation: "compact", maximumFractionDigits: 1 }).toLowerCase();
const usd = (v: string) => (Number(v) > 0 ? `$${v}` : "<$0.01");

// How close the plan is to a limit: reached, near (80% or Claude's own warning), or fine.
export function planTone(windows: PlanWindow[]): { tone: Tone; word: string } | null {
  if (windows.some((w) => w.status === "rejected")) return { tone: "down", word: "Limit reached" };
  if (windows.some((w) => w.status === "allowed_warning" || (w.used ?? 0) >= 80)) {
    return { tone: "wait", word: "Near your limit" };
  }
  return null;
}

// One meter row: its name, the bar, then the figure and when it resets.
function Meter({
  name,
  used,
  tone,
  note,
}: {
  name: string;
  used: number | null;
  tone: string;
  note: string;
}) {
  return (
    <li className={`sub-window ${tone}`}>
      <span className="sub-window-name">{name}</span>
      <span
        className="sub-meter"
        role="meter"
        aria-label={`${name} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(used ?? 0, 100)}
        aria-valuetext={used === null ? "Not known since it reset" : `${used}%`}
      >
        <i style={{ width: `${Math.min(used ?? 0, 100)}%` }} />
      </span>
      <span className="sub-window-used">
        {used === null ? "—" : `${used}%`}
        <span className="sub-window-note muted">{note}</span>
      </span>
    </li>
  );
}

// This app's own runs, today and this month: one line each.
function AppRows({ title, today, month }: { title: string; today: AppUsage; month: AppUsage }) {
  const line = (u: AppUsage) =>
    u.runs === 0
      ? "No runs"
      : `${u.runs} ${u.runs === 1 ? "run" : "runs"} · ${tokenCount(u.tokens)} tokens · ${usd(u.apiCost)}`;
  return (
    <>
      <h3>{title}</h3>
      <dl className="sub-usage-list">
        <div className="sub-usage-row">
          <dt>Today</dt>
          <dd>{line(today)}</dd>
        </div>
        <div className="sub-usage-row">
          <dt>Month</dt>
          <dd>{line(month)}</dd>
        </div>
      </dl>
    </>
  );
}

// The subscription's usage (decision 102): the plan's windows are the whole account's (Claude
// Code and claude.ai too), as last read on a desk run; below them, this app's own runs, which
// Anthropic can't split out of the plan's share, so they stay in tokens and API-price dollars.
function Usage({ usage }: { usage: SubscriptionUsage }) {
  const warn = planTone(usage.windows);
  return (
    <div className="sub-usage">
      <div className="sub-usage-head">
        <h3>
          Plan · whole account
          {usage.checkedAt ? ` · as of ${at(usage.checkedAt)}` : ""}
        </h3>
        {warn && <Status tone={warn.tone}>{warn.word}</Status>}
      </div>
      {usage.windows.length === 0 ? (
        <p className="settings-hint muted">Shows after the desk&apos;s first run on the plan.</p>
      ) : (
        <ul className="sub-usage-windows">
          {usage.windows.map((w) => (
            <Meter
              key={w.kind}
              name={w.name}
              used={w.used}
              tone={w.status === "rejected" ? "is-full" : (w.used ?? 0) >= 80 ? "is-near" : ""}
              note={w.resetsAt ? at(w.resetsAt) : "reset"}
            />
          ))}
        </ul>
      )}
      <AppRows title="This app · at API prices" today={usage.today} month={usage.month} />
    </div>
  );
}

// The API key's usage (decision 102): all of it is this app's, against the month's cap.
function ApiUsage({ ai }: { ai: AiSettings }) {
  const spent = Number(ai.budget.spent);
  const cap = Number(ai.budget.cap);
  const used = cap > 0 ? Math.round((spent / cap) * 100) : 0;
  return (
    <div className="sub-usage">
      <h3>This app · billed</h3>
      <ul className="sub-usage-windows">
        <Meter
          name="Cap"
          used={used}
          tone={used >= 100 ? "is-full" : used >= 80 ? "is-near" : ""}
          note={`of $${cap.toFixed(0)} cap`}
        />
      </ul>
      {ai.apiUsage && <AppRows title="Runs" today={ai.apiUsage.today} month={ai.apiUsage.month} />}
    </div>
  );
}

// Telegram's morning summary (decision 57): your own bot; its token goes to .env.
const dollars = (v: string | number) =>
  `$${Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The owner's per-order and daily limits (spec 10, audit 15): every buy, the bots' included, stays
// inside them. Zero until set, and nothing buys until they are. A raise asks once more first.
function Limits() {
  const [now, setNow] = useState<Settings | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [perOrder, setPerOrder] = useState("");
  const [perDay, setPerDay] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const take = (s: Settings) => {
    setNow(s);
    setPerOrder(Number(s.perOrder) > 0 ? s.perOrder : "");
    setPerDay(Number(s.perDay) > 0 ? s.perDay : "");
  };
  useEffect(() => {
    getSettings().then(take, () => setFailed(true));
  }, [attempt]);
  const unset = now !== null && !(Number(now.perOrder) > 0);
  const raises =
    now !== null &&
    !unset &&
    (Number(perOrder) > Number(now.perOrder) || Number(perDay) > Number(now.perDay));
  const changed =
    now !== null &&
    Number(perOrder) > 0 &&
    Number(perDay) > 0 &&
    (Number(perOrder) !== Number(now.perOrder) || Number(perDay) !== Number(now.perDay));
  const save = () => {
    setBusy(true);
    setNote(null);
    setLimits(perOrder, perDay).then(
      (s) => {
        take(s);
        setBusy(false);
        setAsking(false);
        setNote({ ok: true, text: "Limits saved" });
      },
      (e: unknown) => {
        setBusy(false);
        setAsking(false);
        setNote({ ok: false, text: errorOf(e, "The limits weren't saved.") });
      },
    );
  };
  const status: { tone: Tone; word: string } | null = !now
    ? null
    : unset
      ? { tone: "down", word: "Not set: nothing buys" }
      : { tone: "up", word: `${dollars(now.leftToday)} left today` };
  return (
    <section className="set-section" aria-labelledby="settings-limits">
      <CardHead id="settings-limits" title="Trading limits">
        {status && <Status tone={status.tone}>{status.word}</Status>}
      </CardHead>
      <p className="settings-intro muted">
        Every buy stays inside these, the DCA book&apos;s, the Trading account&apos;s and the
        bots&apos;, checked in the api. The day turns over at midnight, Sydney time.
      </p>
      {!now && !failed && (
        <p className="muted settings-loading" aria-busy="true">
          Loading…
        </p>
      )}
      {!now && failed && (
        <div className="settings-error-row">
          <p className="settings-error" role="alert">
            The limits couldn&apos;t be read.
          </p>
          <button
            type="button"
            className="settings-btn"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {now && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!changed || busy) return;
            if (raises && !asking) setAsking(true);
            else save();
          }}
        >
          <div className="settings-field">
            <label className="settings-label" htmlFor="limit-order">
              Per order ($)
            </label>
            <div className="settings-input">
              <input
                id="limit-order"
                inputMode="decimal"
                placeholder="Not set"
                value={perOrder}
                disabled={busy || asking}
                onChange={(e) => setPerOrder(e.target.value)}
              />
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-label" htmlFor="limit-day">
              Per day ($)
            </label>
            <div>
              <div className="settings-input">
                <input
                  id="limit-day"
                  inputMode="decimal"
                  placeholder="Not set"
                  value={perDay}
                  disabled={busy || asking}
                  onChange={(e) => setPerDay(e.target.value)}
                />
                {!asking && (
                  <button type="submit" className="settings-btn" disabled={busy || !changed}>
                    Save limits
                  </button>
                )}
              </div>
              <p className="settings-hint muted">
                Spent today: {dollars(now.spentToday)}. The per-order limit can&apos;t be more than
                the daily one.
              </p>
            </div>
          </div>
          {asking && (
            <div className="settings-link" role="group" aria-label="Raise the limits">
              <p>
                Raise to {dollars(perOrder)} an order and {dollars(perDay)} a day? The desk and its
                bots may then spend up to that.
              </p>
              <button type="submit" className="settings-btn" disabled={busy}>
                Raise the limits
              </button>
              <button
                type="button"
                className="settings-btn"
                disabled={busy}
                onClick={() => setAsking(false)}
              >
                Keep them
              </button>
            </div>
          )}
          {note && (
            <p className={note.ok ? "muted" : "settings-error"} role={note.ok ? "status" : "alert"}>
              {note.text}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

// Settings › Ledger (decision 99): read only. Each public address, the network it's on and what
// it holds. The desk never holds a key; the agent adds an address through the api. A token found
// on an address but never named is left out, so an airdropped scam token never shows as money.
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
const qty = (v: string) => {
  const n = Number(v);
  const places = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("en-AU", { maximumFractionDigits: places });
};

function Ledger() {
  const [view, setView] = useState<LedgerView | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    getLedger().then(setView, () => setFailed(true));
  }, [attempt]);
  const addresses = view?.addresses ?? [];
  const failing = addresses.some((a) => a.status === "error");
  const read = Math.max(0, ...addresses.map((a) => a.readAt ?? 0));
  const status: { tone: Tone; word: string } | null = !view
    ? null
    : addresses.length === 0
      ? { tone: "idle", word: "No addresses yet" }
      : failing
        ? { tone: "down", word: "One didn't answer" }
        : { tone: "up", word: `${addresses.length} read${read ? ` · ${hhmm(read)}` : ""}` };
  const uncounted = addresses.reduce((n, a) => n + Object.keys(a.unknown ?? {}).length, 0);
  return (
    <section className="set-section" aria-labelledby="settings-ledger">
      <CardHead id="settings-ledger" title="Ledger">
        {status && <Status tone={status.tone}>{status.word}</Status>}
      </CardHead>
      <p className="settings-intro muted">
        Read only, by public address, every 15 minutes. The desk never holds a key or asks for your
        24 words. TAO comes through Taostats.
      </p>
      {!view && !failed && (
        <p className="muted settings-loading" aria-busy="true">
          Loading…
        </p>
      )}
      {!view && failed && (
        <div className="settings-error-row">
          <p className="settings-error" role="alert">
            The Ledger&apos;s addresses couldn&apos;t be read.
          </p>
          <button
            type="button"
            className="settings-btn"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {view && addresses.length === 0 && <p className="muted">No Ledger addresses yet.</p>}
      {addresses.length > 0 && (
        <ul className="ledger-list">
          {addresses.map((a) => (
            <li key={a.id} className="ledger-row">
              <span className="ledger-where">
                <span className="ledger-net">{a.network}</span>
                <code className="ledger-addr" title={a.address}>
                  {short(a.address)}
                </code>
              </span>
              <span className="ledger-bal">
                {a.status === "error" ? (
                  <span className="down">{a.error ?? "Couldn't be read"}</span>
                ) : a.status !== "connected" || !a.coins ? (
                  <span className="muted">Not read yet</span>
                ) : !Object.values(a.coins).some((v) => Number(v) > 0) ? (
                  <span className="muted">Empty</span>
                ) : (
                  Object.entries(a.coins)
                    .filter(([, v]) => Number(v) > 0)
                    .map(([c, v]) => (
                      <span key={c} className="ledger-held">
                        <span className="num">{qty(v)}</span> <span className="muted">{c}</span>
                      </span>
                    ))
                )}
                {a.stale && a.readAt && (
                  <span className="ledger-stale">Last read {hhmm(a.readAt)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {uncounted > 0 && (
        <p className="settings-note muted">
          {uncounted === 1 ? "1 token" : `${uncounted} tokens`} found but not counted: an unknown
          token is often a scam, so never open its link.
        </p>
      )}
    </section>
  );
}

function Telegram({ onRead }: { onRead: (tg: TelegramSettings) => void }) {
  const [tg, setTg] = useState<TelegramSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [token, setToken] = useState("");
  const [time, setTime] = useState("07:30");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getTelegram().then(
      (t) => {
        setTg(t);
        onRead(t);
        setTime(t.time);
      },
      () => setFailed(true),
    );
  }, [attempt, onRead]);
  const act = (action: () => Promise<TelegramSettings>, done: string) => {
    setBusy(true);
    setNote(null);
    action().then(
      (t) => {
        setTg(t);
        onRead(t);
        setBusy(false);
        setNote({ ok: true, text: done });
      },
      (e: unknown) => {
        setBusy(false);
        setNote({ ok: false, text: errorOf(e, "That didn't work.") });
      },
    );
  };
  const status: { tone: Tone; word: string } | null = !tg
    ? null
    : !tg.tokenSet
      ? { tone: "down", word: "Not connected" }
      : tg.chatFound
        ? { tone: "up", word: `Connected${tg.chatName ? ` to ${tg.chatName}` : ""}` }
        : { tone: "wait", word: "Bot saved: link your chat" };
  return (
    <section className="set-section" aria-labelledby="settings-telegram">
      <CardHead id="settings-telegram" title="Morning summary">
        {status && <Status tone={status.tone}>{status.word}</Status>}
      </CardHead>
      <p className="settings-intro muted">
        Once a day from your own Telegram bot, Sydney time: the coach&apos;s mood line, key points
        and deposits left.
      </p>
      {!tg && !failed && (
        <p className="muted settings-loading" aria-busy="true">
          Loading…
        </p>
      )}
      {!tg && failed && (
        <div className="settings-error-row">
          <p className="settings-error" role="alert">
            Telegram settings couldn&apos;t be read.
          </p>
          <button
            type="button"
            className="settings-btn"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {tg && (
        <>
          <div className="settings-field">
            <span className="settings-label">Bot token</span>
            <div>
              <div className="settings-input">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Telegram bot token"
                  placeholder={tg.tokenSet ? "Replace the bot token" : "Bot token from @BotFather"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button
                  type="button"
                  className="settings-btn"
                  disabled={busy || !token.trim()}
                  onClick={() =>
                    act(
                      () => saveTelegramToken(token).finally(() => setToken("")),
                      "Bot token saved",
                    )
                  }
                >
                  Save
                </button>
              </div>
              <p className="settings-hint muted">
                Create a bot with @BotFather in Telegram and paste its token here. Saved to .env,
                never shown again.
              </p>
              {tg.linkCode && (
                <div className="settings-link">
                  <p>
                    Send <code>{tg.linkCode}</code> to your bot in Telegram, then press Link. Only
                    the chat that sends this code gets your summary.
                  </p>
                  <button
                    type="button"
                    className="settings-btn"
                    disabled={busy}
                    onClick={() => act(() => linkTelegram(), "Checked")}
                  >
                    Link
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-label" htmlFor="tg-time">
              Morning summary at
            </label>
            <div className="settings-input">
              <input
                id="tg-time"
                className="settings-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
              <button
                type="button"
                className="settings-btn"
                disabled={busy || time === tg.time}
                onClick={() => act(() => setTelegramTime(time), "Time saved")}
              >
                Save time
              </button>
            </div>
          </div>
          <div className="settings-field">
            <span className="settings-label">Last summary</span>
            <div className="settings-input">
              <span className="settings-value">
                {tg.lastSent ? day(new Date(`${tg.lastSent}T12:00:00Z`)) : "None sent yet"}
              </span>
              <button
                type="button"
                className="settings-btn"
                disabled={busy || !tg.tokenSet}
                onClick={() => act(() => testTelegram(), "Test summary sent")}
              >
                Send a test
              </button>
            </div>
          </div>
          {note && (
            <p className={note.ok ? "muted" : "settings-error"} role={note.ok ? "status" : "alert"}>
              {note.text}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// Which pages and features show on the desk (decision 85). Off only hides one and skips loading
// it: what it runs keeps running, said beside its switch.
function Pages() {
  const { flags, switchFeature } = useFeatures();
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const flip = (info: FeatureInfo, on: boolean) => {
    setBusy(info.id);
    setSaid(null);
    switchFeature(info.id, on).then(
      () => {
        setBusy(null);
        setSaid({
          ok: true,
          text: on
            ? `${info.name} is on your desk.`
            : `${info.name} is off. Turn it on here any time.`,
        });
      },
      (e: unknown) => {
        setBusy(null);
        setSaid({ ok: false, text: errorOf(e, `${info.name} wasn't switched.`) });
      },
    );
  };

  return (
    <section className="set-section set-wide" aria-labelledby="settings-pages">
      <CardHead id="settings-pages" title="Pages" />
      <p className="settings-intro muted">
        Choose what shows on your desk. A page that&apos;s off is hidden and its code isn&apos;t
        loaded. Its orders, bots, checks and agents keep running: the kill switch stops trading, not
        this. Features added later start off until you turn them on.
      </p>
      {flags === null ? (
        <p className="muted settings-loading" aria-busy="true">
          Loading…
        </p>
      ) : (
        <ul className="feature-rows">
          {FEATURES.map((info) => {
            const on = featureOn(flags, info.id);
            return (
              <li key={info.id} className={`feature-row${on ? "" : " off"}`}>
                <div>
                  <strong>{info.name}</strong>
                  {info.always && <span className="settings-tag is-fixed">Always on</span>}
                  {isNew(flags, info) && <span className="settings-tag">New</span>}
                  <span className="muted feature-what">
                    {info.what}
                    {!on && info.keeps && (
                      <>
                        {" · "}
                        <span className="feature-keeps">{info.keeps}</span>
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${info.name} page`}
                  className="feature-switch"
                  disabled={info.always || busy !== null}
                  onClick={() => flip(info, !on)}
                >
                  <span className={`switch${on ? " on" : ""}`} aria-hidden="true">
                    <i />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {said && (
        <p
          className={said.ok ? "settings-hint muted" : "settings-error"}
          role={said.ok ? "status" : "alert"}
        >
          {said.text}
        </p>
      )}
    </section>
  );
}
