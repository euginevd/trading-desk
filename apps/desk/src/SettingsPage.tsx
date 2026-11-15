// Settings (decisions 50 and 51): the desk's choices in one place, starting with how the AI
// reaches Claude. Sign in or paste a key here, as in Claude Code; the api saves it to .env and
// this page only ever shows whether each is set.
import { useEffect, useState } from "react";
import {
  finishSignIn,
  getAiSettings,
  getProfile,
  saveAiKey,
  setAiSettings,
  setProfile,
  startSignIn,
} from "./api";
import type { AiMode, AiSettings } from "./types";

const MODES: { mode: AiMode; name: string }[] = [
  { mode: "api_key", name: "API key (pay per use)" },
  { mode: "subscription", name: "Claude subscription (personal use)" },
];

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function SettingsPage() {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAiSettings().then(setAi, (e: unknown) => setError(message(e, "Settings couldn't be read.")));
  }, []);

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

  return (
    <main className="wrap settings">
      <You />
      <section className="card settings-card" aria-labelledby="settings-ai">
        <h2 id="settings-ai">AI</h2>
        {!ai && !error && <p className="muted">Loading…</p>}
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        {ai && (
          <>
            <div className="settings-row">
              <span className="settings-label">Answer with</span>
              <div className="seg dca-seg settings-seg" role="group" aria-label="Answer with">
                {MODES.map(({ mode, name }) => (
                  <button
                    key={mode}
                    type="button"
                    className={ai.mode === mode ? "on" : ""}
                    aria-pressed={ai.mode === mode}
                    disabled={saving}
                    onClick={() =>
                      void run(() => setAiSettings(mode, ai.fallback, ai.model), "Not saved.")
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row settings-model">
              <span className="settings-label">Model</span>
              <div className="seg dca-seg settings-seg" role="group" aria-label="Model">
                {ai.models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={ai.model === m.id ? "on" : ""}
                    aria-pressed={ai.model === m.id}
                    disabled={saving}
                    onClick={() =>
                      void run(() => setAiSettings(ai.mode, ai.fallback, m.id), "Not saved.")
                    }
                  >
                    {m.name.replace("Claude ", "")}
                  </button>
                ))}
              </div>
              <p className="settings-hint muted">
                Opus: the deepest reasoning. Sonnet: about half Opus&apos;s price. Haiku: the
                cheapest and fastest.
              </p>
            </div>
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
            <ul className="settings-creds">
              <ApiKey ai={ai} saving={saving} run={run} />
              <Subscription ai={ai} saving={saving} run={run} onError={setError} />
            </ul>
            <p className="settings-note muted">
              Applies to every AI feature: plans, Analyse all and the Dashboard&apos;s signals. What
              you enter is saved to .env and never shown again.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

type Run = (action: () => Promise<AiSettings>, failed: string) => Promise<boolean>;

function ApiKey({ ai, saving, run }: { ai: AiSettings; saving: boolean; run: Run }) {
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
    <li>
      <div className="settings-cred-head">
        <span className={`settings-dot${ai.apiKeySet ? "" : " off"}`} aria-hidden="true" />
        <strong>API credits</strong>
        <span className="muted">
          {ai.apiKeySet
            ? ` · Key set · $${ai.budget.spent} of $${ai.budget.cap} this month`
            : " · No key yet"}
        </span>
        {ai.apiKeySet && !open && (
          <button className="link" type="button" onClick={() => setOpen(true)}>
            Replace
          </button>
        )}
      </div>
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
          <button type="button" disabled={saving || !key.trim()} onClick={save}>
            Save key
          </button>
        </div>
      )}
      <p className="settings-hint muted">
        Create a key at console.anthropic.com under API keys, then paste it here.
      </p>
    </li>
  );
}

function Subscription({
  ai,
  saving,
  run,
  onError,
}: {
  ai: AiSettings;
  saving: boolean;
  run: Run;
  onError: (error: string | null) => void;
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
    <li>
      <div className="settings-cred-head">
        <span className={`settings-dot${ai.tokenSet ? "" : " off"}`} aria-hidden="true" />
        <strong>Claude subscription</strong>
        <span className="muted">{ai.tokenSet ? " · Signed in" : " · Not signed in"}</span>
        {!url && (
          <button
            className={ai.tokenSet ? "link" : "settings-primary"}
            type="button"
            disabled={starting || saving}
            onClick={start}
          >
            {starting ? "Starting…" : ai.tokenSet ? "Sign in again" : "Sign in with Claude"}
          </button>
        )}
      </div>
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
            <button type="button" disabled={saving || !code.trim()} onClick={finish}>
              {saving ? "Signing in…" : "Finish sign-in"}
            </button>
            <button className="link" type="button" onClick={() => setUrl(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <p className="settings-hint muted">
        Needs a Pro or Max plan. Signs in the way Claude Code does; the token lasts a year.
      </p>
    </li>
  );
}

function You() {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    getProfile().then(
      (p) => {
        setName(p.name);
        setSaved(p.name);
      },
      () => setSaved(""),
    );
  }, []);
  const save = () =>
    setProfile(name).then(
      (p) => {
        setSaved(p.name);
        setName(p.name);
        setNote("Saved");
      },
      (e: unknown) => setNote(e instanceof Error ? e.message : "Not saved."),
    );
  return (
    <section className="card settings-card" aria-labelledby="settings-you">
      <h2 id="settings-you">You</h2>
      <div className="settings-input settings-you">
        <input
          aria-label="Your name"
          placeholder="Your name"
          maxLength={40}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNote("");
          }}
        />
        <button
          type="button"
          disabled={saved === null || name === saved}
          onClick={() => void save()}
        >
          Save name
        </button>
        {note && <span className="muted">{note}</span>}
      </div>
      <p className="settings-hint muted">
        For the Dashboard&apos;s greeting. Kept on this machine only, never in the code.
      </p>
    </section>
  );
}
