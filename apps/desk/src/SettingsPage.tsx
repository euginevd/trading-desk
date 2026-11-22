// Settings (decisions 50, 51, 65 and 85): how the desk connects and behaves, said in a sentence, then
// how it answers (Claude), the morning summary (Telegram) and which pages show, as hairline sections. Sign in or
// paste a key here, as in Claude Code; the api saves it to .env and this page only ever shows
// whether each is set. Your name lives in the Profile.
import { type ReactNode, useEffect, useState } from "react";
import {
  addLedgerAddress,
  countLedgerToken,
  finishSignIn,
  getLedger,
  removeLedgerAddress,
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
  LedgerAddress,
  LedgerView,
  Settings,
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
      <Limits />
      <Ledger />
      <Telegram onRead={setTg} />
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
    </ProviderCard>
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

// Settings › Ledger (decision 99): the Ledger's public addresses, what each holds and when it
// was read. The desk never holds a key: an address only reads. A token found on an address
// counts only once named here, so an airdropped scam token never shows as money.
// The coin a network's own balance is in, and the networks whose tokens the desk reads by contract.
const NETWORK_COIN: Record<string, string> = {
  Solana: "SOL",
  Ethereum: "ETH",
  HyperEVM: "HYPE",
  Sui: "SUI",
  NEAR: "NEAR",
  Bitcoin: "BTC",
};
const EVM_NETWORKS = new Set(["Ethereum", "HyperEVM"]);
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
const qty = (v: string) => Number(v).toLocaleString("en-AU", { maximumFractionDigits: 6 });

function balances(a: LedgerAddress): string {
  if (a.status === "error") return a.error ?? "Couldn't be read";
  if (a.status !== "connected" || !a.coins) return "Not read yet";
  const held = Object.entries(a.coins).filter(([, v]) => Number(v) > 0);
  return held.length ? held.map(([c, v]) => `${qty(v)} ${c}`).join(" · ") : "Empty";
}

function Ledger() {
  const [view, setView] = useState<LedgerView | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [coin, setCoin] = useState("SOL");
  const [network, setNetwork] = useState("Solana");
  const [contract, setContract] = useState<Record<number, { at: string; coin: string }>>({});
  const [address, setAddress] = useState("");
  const [naming, setNaming] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    getLedger().then(setView, () => setFailed(true));
  }, [attempt]);
  const act = (action: () => Promise<LedgerView>, done: string, after?: () => void) => {
    setBusy(true);
    setNote(null);
    action().then(
      (next) => {
        setView(next);
        setBusy(false);
        setNote({ ok: true, text: done });
        after?.(); // what you typed stays until it's saved
      },
      (e: unknown) => {
        setBusy(false);
        setNote({ ok: false, text: errorOf(e, "Not saved.") });
      },
    );
  };
  const failing = view?.addresses.some((a) => a.status === "error");
  const status: { tone: Tone; word: string } | null = !view
    ? null
    : view.addresses.length === 0
      ? { tone: "idle", word: "No addresses yet" }
      : failing
        ? { tone: "down", word: "One didn't answer" }
        : { tone: "up", word: `${view.addresses.length} read` };
  return (
    <section className="set-section" aria-labelledby="settings-ledger">
      <CardHead id="settings-ledger" title="Ledger">
        {status && <Status tone={status.tone}>{status.word}</Status>}
      </CardHead>
      <p className="settings-intro muted">
        The desk reads your Ledger by its public addresses, through the api, every 15 minutes. It
        never holds a key and never asks for your 24 words. TAO comes through Taostats, by
        TAO_COLDKEY in .env.
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
      {view && view.addresses.length === 0 && (
        <p className="muted">No Ledger addresses yet. Add one when you move a coin off Binance.</p>
      )}
      {view && view.addresses.length > 0 && (
        <ul className="ledger-list">
          {view.addresses.map((a) => (
            <li key={a.id} className="ledger-row">
              <div className="ledger-head">
                <span className="ledger-coin">{a.coin}</span>
                <span className="muted">{a.network}</span>
                <code className="ledger-addr" title={a.address}>
                  {short(a.address)}
                </code>
                <span className={`ledger-bal num${a.status === "error" ? " down" : ""}`}>
                  {balances(a)}
                </span>
                <span className={a.stale ? "ledger-stale" : "muted"}>
                  {a.readAt ? `${a.stale ? "Last read " : ""}${hhmm(a.readAt)}` : ""}
                </span>
                <button
                  type="button"
                  className="settings-btn"
                  disabled={busy}
                  onClick={() => act(() => removeLedgerAddress(a.id), "Address removed")}
                >
                  Remove
                </button>
              </div>
              {Object.keys(a.tokens).length > 0 && (
                <ul className="ledger-counted">
                  {Object.entries(a.tokens).map(([mint, name]) => (
                    <li key={mint}>
                      <span>Counted: {name}</span> <code title={mint}>{short(mint)}</code>{" "}
                      <button
                        type="button"
                        className="settings-btn"
                        disabled={busy}
                        onClick={() =>
                          act(() => countLedgerToken(a.id, mint, null), `${name} not counted`)
                        }
                      >
                        Stop counting
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {EVM_NETWORKS.has(a.network) && (
                // An EVM node can't list an address's tokens: count one by its contract.
                <form
                  className="ledger-token"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const t = contract[a.id];
                    const name = t?.coin.trim().toUpperCase() ?? "";
                    if (t?.at.trim() && name)
                      act(() => countLedgerToken(a.id, t.at.trim(), name), `${name} counted`);
                  }}
                >
                  <input
                    aria-label={`Token contract on ${a.network}`}
                    placeholder="Token contract (0x…)"
                    value={contract[a.id]?.at ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      setContract({
                        ...contract,
                        [a.id]: { at: e.target.value, coin: contract[a.id]?.coin ?? "" },
                      })
                    }
                  />
                  <input
                    aria-label={`Coin for that contract on ${a.network}`}
                    placeholder="Coin, such as USDC"
                    value={contract[a.id]?.coin ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      setContract({
                        ...contract,
                        [a.id]: { at: contract[a.id]?.at ?? "", coin: e.target.value },
                      })
                    }
                  />
                  <button type="submit" className="settings-btn" disabled={busy}>
                    Count a token
                  </button>
                </form>
              )}
              {a.unknown && Object.keys(a.unknown).length > 0 && (
                <div className="ledger-unknown">
                  <p className="muted">
                    Found but not counted. Count one only if you sent it here yourself: an unknown
                    token is often a scam, so never open its link.
                  </p>
                  {Object.entries(a.unknown).map(([mint, v]) => (
                    <form
                      key={mint}
                      className="ledger-token"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = (naming[mint] ?? "").trim().toUpperCase();
                        if (name) act(() => countLedgerToken(a.id, mint, name), `${name} counted`);
                      }}
                    >
                      <code title={mint}>{short(mint)}</code>
                      <span className="num">{qty(v)}</span>
                      <input
                        aria-label={`Coin for token ${short(mint)}`}
                        placeholder="Coin, such as USDC"
                        value={naming[mint] ?? ""}
                        disabled={busy}
                        onChange={(e) => setNaming({ ...naming, [mint]: e.target.value })}
                      />
                      <button type="submit" className="settings-btn" disabled={busy}>
                        Count it
                      </button>
                    </form>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {view && (
        <form
          className="ledger-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!address.trim() || busy) return;
            act(
              () => addLedgerAddress(coin, network, address.trim()),
              "Address added",
              () => setAddress(""),
            );
          }}
        >
          <input
            aria-label="Coin"
            className="ledger-coin-input"
            value={coin}
            disabled={busy}
            onChange={(e) => setCoin(e.target.value.toUpperCase())}
          />
          <select
            aria-label="Network"
            value={network}
            disabled={busy}
            onChange={(e) => {
              setNetwork(e.target.value);
              setCoin(NETWORK_COIN[e.target.value] ?? coin);
            }}
          >
            {view.networks.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <input
            aria-label="Public address"
            placeholder={
              network === "Bitcoin"
                ? "Account xpub from Ledger Live › Edit account › Advanced (never your 24 words)"
                : "Public address from Ledger Live (never your 24 words)"
            }
            value={address}
            disabled={busy}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" className="settings-btn" disabled={busy || !address.trim()}>
            Add
          </button>
        </form>
      )}
      {note && (
        <p className={note.ok ? "muted" : "settings-error"} role={note.ok ? "status" : "alert"}>
          {note.text}
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
