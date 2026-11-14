// Settings (decision 50): the desk's choices in one place, starting with how the AI reaches
// Claude. Keys and tokens stay in .env; this page only shows whether each is set.
import { useEffect, useState } from "react";
import { getAiSettings, setAiSettings } from "./api";
import type { AiMode, AiSettings } from "./types";

const MODES: { mode: AiMode; name: string; credential: string; hint: string }[] = [
  {
    mode: "api_key",
    name: "API key (pay per use)",
    credential: "ANTHROPIC_API_KEY",
    hint: "Create a key at console.anthropic.com under API keys, put it in .env as ANTHROPIC_API_KEY, then restart the api.",
  },
  {
    mode: "subscription",
    name: "Claude subscription (personal use)",
    credential: "CLAUDE_CODE_OAUTH_TOKEN",
    hint: "Run `claude setup-token` in a terminal, put the token in .env as CLAUDE_CODE_OAUTH_TOKEN, then restart the api.",
  },
];

export default function SettingsPage() {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAiSettings().then(setAi, (e: unknown) =>
      setError(e instanceof Error ? e.message : "Settings couldn't be read."),
    );
  }, []);

  const save = (mode: AiMode, fallback: boolean) => {
    setSaving(true);
    setError(null);
    setAiSettings(mode, fallback).then(
      (next) => {
        setAi(next);
        setSaving(false);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : "Not saved. Try again.");
        setSaving(false);
      },
    );
  };

  return (
    <main className="wrap settings">
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
                    onClick={() => save(mode, ai.fallback)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            {ai.mode === "subscription" && (
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={ai.fallback}
                  disabled={saving}
                  onChange={(e) => save(ai.mode, e.target.checked)}
                />
                Use the API key if the subscription fails
              </label>
            )}
            <ul className="settings-creds">
              {MODES.map(({ mode, name, credential, hint }) => {
                const set = mode === "api_key" ? ai.apiKeySet : ai.tokenSet;
                return (
                  <li key={mode}>
                    <div>
                      <span className={`settings-dot${set ? "" : " off"}`} aria-hidden="true" />
                      <strong>{name}</strong>
                      <span className="muted">
                        {set ? ` · ${credential} is set` : ` · ${credential} isn't set`}
                        {mode === "api_key" &&
                          ` · $${ai.budget.spent} of $${ai.budget.cap} this month`}
                      </span>
                    </div>
                    <p className="settings-hint muted">{hint}</p>
                  </li>
                );
              })}
            </ul>
            <p className="settings-note muted">
              Model: {ai.model === "claude-opus-5-5" ? "Claude Opus 5.5" : ai.model}. Applies to
              every AI feature: plans, Analyse all and the Dashboard&apos;s signals. Keys and tokens
              stay in .env; the desk never shows them.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
