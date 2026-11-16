// Settings (decisions 50, 51 and 65): how the desk connects and behaves, said in a sentence, then
// how it answers (Claude) and the morning summary (Telegram) as hairline sections. Sign in or
// paste a key here, as in Claude Code; the api saves it to .env and this page only ever shows
// whether each is set. Your name lives in the Profile.
import { type ReactNode, useEffect, useState } from "react";
import {
  finishSignIn,
  getAiSettings,
  getTelegram,
  linkTelegram,
  saveTelegramToken,
  setTelegramTime,
  testTelegram,
  saveAiKey,
  setAiSettings,
  startSignIn,
} from "./api";
import type { AiMode, AiSettings, TelegramSettings } from "./types";

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

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type Tone = "up" | "wait" | "down" | "idle";

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
        ? `Your summary goes to Telegram at ${tg.time}.`
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
    getAiSettings().then(setAi, (e: unknown) => setError(message(e, "Settings couldn't be read.")));
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
        setError(message(e, failed));
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
            <p className="settings-note muted">
              Applies to every AI feature: the coach, the desk&apos;s agents, Analyse and the
              Profile&apos;s command bar. What you enter is saved to .env and never shown again.
            </p>
          </>
        )}
      </section>
      <Telegram onRead={setTg} />
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
        onError(message(e, "The sign-in didn't start."));
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
        setNote({ ok: false, text: message(e, "That didn't work.") });
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
              <span className="settings-value">{tg.lastSent ?? "None sent yet"}</span>
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
