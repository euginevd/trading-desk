// The Profile's cards (decision 58): one per section, each with its own pencil, "last updated",
// a badge for pending suggestions, and the diff of a proposed change with Accept, Edit, Reject.
import { type ReactNode, useState } from "react";
import { dateTime } from "./format";
import {
  CHOICE_WORDS,
  type FieldSpec,
  LISTS,
  RECORDS,
  TITLES,
  audText,
  dayText,
  isList,
  isRecord,
  shown,
} from "./profileFields";
import type {
  CheckStatus,
  FoundationStatus,
  ProfileDoc,
  ProfilePage,
  ProfileSection,
  ProfileSuggestion,
} from "./types";

// Status is a word and a mark, never colour alone (code-standards 26).
const CHECK: Record<CheckStatus, { mark: string; tone: string }> = {
  ok: { mark: "✓", tone: "ok" },
  attention: { mark: "▲", tone: "warn" },
  broken: { mark: "✕", tone: "bad" },
  unset: { mark: "–", tone: "dim" },
};
const FOUNDATION: Record<FoundationStatus, { word: string; mark: string; tone: string }> = {
  done: { word: "Done", mark: "✓", tone: "ok" },
  parked: { word: "Parked", mark: "◐", tone: "warn" },
  below: { word: "Below target", mark: "✕", tone: "bad" },
  unset: { word: "Not set", mark: "–", tone: "dim" },
};

export function Tag({ tone, mark, children }: { tone: string; mark: string; children: ReactNode }) {
  return (
    <span className={`pf-tag ${tone}`}>
      <span aria-hidden="true">{mark}</span> {children}
    </span>
  );
}

export function CheckTag({ status, text }: { status: CheckStatus; text: string }) {
  return (
    <Tag tone={CHECK[status].tone} mark={CHECK[status].mark}>
      {text}
    </Tag>
  );
}

// Editing: each field as text while it's typed, back to the document's shape on save.

type Draft = Record<string, string | boolean>;

function toDraft(f: FieldSpec, value: unknown): string | boolean {
  if (f.kind === "bool") return value === true;
  if (value === null || value === undefined) return "";
  if (f.kind === "texts") return (value as string[]).join("\n");
  if (f.kind === "targets")
    return (value as { coin: string; pct: string }[]).map((t) => `${t.coin} ${t.pct}`).join("\n");
  return String(value);
}

function fromDraft(f: FieldSpec, value: string | boolean): unknown {
  if (f.kind === "bool") return value === true;
  const text = String(value);
  if (f.kind === "texts")
    return text
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
  if (f.kind === "targets")
    return text
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([coin, pct]) => ({
        coin: (coin ?? "").toUpperCase(),
        pct: (pct ?? "").replace("%", ""),
      }));
  return text.trim() === "" ? null : text.trim();
}

function Field({
  f,
  id,
  value,
  onChange,
}: {
  f: FieldSpec;
  id: string;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}) {
  if (f.kind === "bool")
    return (
      <label className="pf-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {f.label}
      </label>
    );
  const hint =
    f.kind === "texts"
      ? "One a line"
      : f.kind === "targets"
        ? "One a line, such as BTC 50"
        : f.kind === "money"
          ? "A$, such as 7000 or 7K"
          : null;
  return (
    <div className="pf-field">
      <label htmlFor={id}>{f.label}</label>
      {f.kind === "choice" ? (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not set</option>
          {f.choices?.map((c) => (
            <option key={c} value={c}>
              {CHOICE_WORDS[c] ?? c}
            </option>
          ))}
        </select>
      ) : f.kind === "long" || f.kind === "texts" || f.kind === "targets" ? (
        <textarea
          id={id}
          rows={f.kind === "long" ? 3 : 2}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type={f.kind === "date" ? "date" : "text"}
          inputMode={["money", "pct", "num", "year"].includes(f.kind) ? "decimal" : undefined}
          value={String(value)}
          placeholder="Not set"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <span className="pf-hint">{hint}</span>}
    </div>
  );
}

// One editor for every section: a record's fields, a list's rows, or Additional info's text.
export function Editor({
  section,
  value,
  saving,
  error,
  onSave,
  onCancel,
}: {
  section: ProfileSection;
  value: unknown;
  saving: boolean;
  error: string | null;
  onSave: (value: unknown, reason: string) => void;
  onCancel: () => void;
}) {
  const [record, setRecord] = useState<Draft>(() =>
    isRecord(section)
      ? Object.fromEntries(
          RECORDS[section].map((f) => [
            f.key,
            toDraft(f, (value as Record<string, unknown>)[f.key]),
          ]),
        )
      : {},
  );
  const [rows, setRows] = useState<Draft[]>(() =>
    isList(section)
      ? (value as Record<string, unknown>[]).map((item) =>
          Object.fromEntries(LISTS[section].map((f) => [f.key, toDraft(f, item[f.key])])),
        )
      : [],
  );
  const [text, setText] = useState(() => (typeof value === "string" ? value : ""));
  const [reason, setReason] = useState("");

  const result = (): unknown => {
    if (isRecord(section))
      return Object.fromEntries(
        RECORDS[section].map((f) => [f.key, fromDraft(f, record[f.key] ?? "")]),
      );
    if (isList(section))
      return rows.map((row) =>
        Object.fromEntries(LISTS[section].map((f) => [f.key, fromDraft(f, row[f.key] ?? "")])),
      );
    return text;
  };
  const blank = (): Draft =>
    isList(section)
      ? Object.fromEntries(
          LISTS[section].map((f) => [f.key, f.kind === "bool" ? f.key === "counts" : ""]),
        )
      : {};

  return (
    <form
      className="pf-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(result(), reason);
      }}
    >
      {isRecord(section) &&
        RECORDS[section].map((f) => (
          <Field
            key={f.key}
            f={f}
            id={`pf-${section}-${f.key}`}
            value={record[f.key] ?? ""}
            onChange={(v) => setRecord({ ...record, [f.key]: v })}
          />
        ))}
      {isList(section) && (
        <>
          {rows.map((row, i) => (
            <fieldset key={i} className="pf-row">
              <legend className="pf-hint">
                {TITLES[section]} {i + 1}
              </legend>
              {LISTS[section].map((f) => (
                <Field
                  key={f.key}
                  f={f}
                  id={`pf-${section}-${i}-${f.key}`}
                  value={row[f.key] ?? ""}
                  onChange={(v) =>
                    setRows(rows.map((r, j) => (j === i ? { ...r, [f.key]: v } : r)))
                  }
                />
              ))}
              <button
                type="button"
                className="pf-link"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </fieldset>
          ))}
          <button type="button" onClick={() => setRows([...rows, blank()])}>
            Add {TITLES[section].toLowerCase().replace(/s$/, "")}
          </button>
        </>
      )}
      {section === "additional_info" && (
        <div className="pf-field">
          <label htmlFor="pf-more">Notes (Markdown)</label>
          <textarea id="pf-more" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      <div className="pf-field">
        <label htmlFor={`pf-${section}-reason`}>Why (optional, kept with the version)</label>
        <input
          id={`pf-${section}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="pf-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save as a new version"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// A proposed change, shown on the card it touches.
export function SuggestionDiff({
  suggestion,
  section,
  busy,
  onAccept,
  onEdit,
  onReject,
}: {
  suggestion: ProfileSuggestion;
  section: ProfileSection;
  busy: boolean;
  onAccept: (reason: string) => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const [reason, setReason] = useState(suggestion.reason);
  const here = suggestion.changes.filter((c) => c.section === section);
  return (
    <div className="pf-diff" aria-label={`Suggested by ${suggestion.author}`}>
      <p className="pf-diff-head">
        <strong>{suggestion.summary}</strong>{" "}
        <span className="muted">· from {suggestion.author}</span>
      </p>
      <ul className="pf-diff-list">
        {here.map((c) => (
          <li key={`${c.key}-${c.to}`}>
            <span className="muted">{c.label}</span>{" "}
            {c.from && (
              <>
                <del className="pf-old">{c.from}</del> →{" "}
              </>
            )}
            <ins className="pf-new">{c.to}</ins>
          </li>
        ))}
      </ul>
      {suggestion.blocked && (
        <p className="pf-conflict bad" role="alert">
          <span aria-hidden="true">✕</span> {suggestion.blocked}
        </p>
      )}
      {suggestion.conflicts.map((c) => (
        <p key={c} className="pf-conflict">
          <span aria-hidden="true">▲</span> Conflict: {c}
        </p>
      ))}
      <div className="pf-field">
        <label htmlFor={`pf-reason-${suggestion.id}`}>Why (optional)</label>
        <input
          id={`pf-reason-${suggestion.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="pf-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || suggestion.blocked !== null}
          onClick={() => onAccept(reason)}
        >
          Accept
        </button>
        <button type="button" disabled={busy} onClick={onEdit}>
          Edit
        </button>
        <button type="button" disabled={busy} onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}

// The card around each section.
export function Card({
  section,
  updated,
  badge,
  lock,
  wide,
  onEdit,
  children,
}: {
  section: ProfileSection;
  updated: number | null;
  badge: number;
  lock?: ReactNode;
  wide?: boolean;
  onEdit?: () => void;
  children: ReactNode;
}) {
  const id = `pf-card-${section}`;
  return (
    <section id={id} className={`card pf-card${wide ? " wide" : ""}`} aria-labelledby={`${id}-h`}>
      <div className="pf-head">
        <h2 id={`${id}-h`}>{TITLES[section]}</h2>
        {badge > 0 && (
          <span className="pf-badge">
            {badge} suggestion{badge > 1 ? "s" : ""}
          </span>
        )}
        {lock}
        <span className="pf-updated">
          {updated ? `Updated ${dateTime(updated)}` : "Never changed"}
        </span>
        {onEdit && (
          <button
            type="button"
            className="pf-pencil"
            onClick={onEdit}
            aria-label={`Edit ${TITLES[section].toLowerCase()}`}
            title="Edit"
          >
            <span aria-hidden="true">✎</span>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

// What each card shows when it isn't being edited.

function Rows({ items }: { items: [string, ReactNode, ReactNode?][] }) {
  return (
    <dl className="pf-dl">
      {items.map(([label, value, extra]) => (
        <div key={label} className="pf-dl-row">
          <dt>{label}</dt>
          <dd className={value === "Not set" ? "pf-unset" : undefined}>{value}</dd>
          <dd className="pf-dl-extra">{extra}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecordView({ section, doc }: { section: "identity" | "income"; doc: ProfileDoc }) {
  const data = doc[section] as unknown as Record<string, unknown>;
  return <Rows items={RECORDS[section].map((f) => [f.label, shown(f, data[f.key])])} />;
}

export function SectionView({ section, page }: { section: ProfileSection; page: ProfilePage }) {
  const doc = page.profile;
  const live = page.live;
  switch (section) {
    case "identity":
    case "income":
      return <RecordView section={section} doc={doc} />;
    case "goals":
      return doc.goals.length === 0 ? (
        <p className="pf-unset">Not set. Add the goals this plan works toward.</p>
      ) : (
        <Rows
          items={doc.goals.map((g) => [
            `${audText(g.amount, g.currency)}${g.date ? ` by ${dayText(g.date)}` : ""}`,
            [g.label, g.then_rule && `then ${g.then_rule}`].filter(Boolean).join(", ") || "—",
          ])}
        />
      );
    case "foundations": {
      const f = doc.foundations as unknown as Record<string, unknown>;
      return (
        <Rows
          items={RECORDS.foundations
            .filter(
              (spec) => spec.key !== "emergency_months" && spec.key !== "health_cover_monthly_aud",
            )
            .map((spec) => {
              const status = live.foundations[spec.key];
              let value = shown(spec, f[spec.key]);
              if (spec.key === "emergency_fund_aud" && doc.foundations.emergency_months)
                value += ` · ${doc.foundations.emergency_months} months`;
              if (spec.key === "health_cover_status" && doc.foundations.health_cover_monthly_aud)
                value += ` · ~${audText(doc.foundations.health_cover_monthly_aud)}/month`;
              if (spec.key === "min_cash_aud" && live.strip.cash.now && f.min_cash_aud)
                value = `${audText(live.strip.cash.now)} of ${audText(String(f.min_cash_aud))}`;
              return [
                spec.label,
                value,
                status && (
                  <Tag tone={FOUNDATION[status].tone} mark={FOUNDATION[status].mark}>
                    {FOUNDATION[status].word}
                  </Tag>
                ),
              ];
            })}
        />
      );
    }
    case "strategy":
      return (
        <>
          <p className={doc.strategy.text ? "pf-prose" : "pf-unset"}>
            {doc.strategy.text ?? "Not set"}
          </p>
          <Rows
            items={RECORDS.strategy
              .slice(1)
              .map((f) => [
                f.label,
                shown(f, (doc.strategy as unknown as Record<string, unknown>)[f.key]),
              ])}
          />
        </>
      );
    case "rules": {
      const rules = doc.rules as unknown as Record<string, unknown>;
      return (
        <>
          <Rows
            items={RECORDS.rules
              .filter((f) => f.key !== "behaviour_rules")
              .map((f) => {
                const check = live.checks[f.key as keyof typeof live.checks];
                const unset = rules[f.key] === null;
                return [
                  f.label,
                  shown(f, rules[f.key]),
                  check ? (
                    <CheckTag status={check.status} text={check.text} />
                  ) : unset && ["money", "pct", "num"].includes(f.kind) ? (
                    <span className="pf-hint">Not checked</span>
                  ) : null,
                ];
              })}
          />
          <div className="pf-chips" aria-label="Behaviour rules">
            {doc.rules.behaviour_rules.length === 0 ? (
              <span className="pf-unset">No behaviour rules yet.</span>
            ) : (
              doc.rules.behaviour_rules.map((b) => (
                <span key={b} className="pf-chip">
                  {b}
                </span>
              ))
            )}
          </div>
        </>
      );
    }
    case "holdings":
      return <HoldingsView page={page} />;
    case "lessons":
      return doc.lessons.length === 0 ? (
        <p className="pf-unset">No lessons yet. Log one from the command bar.</p>
      ) : (
        <ol className="pf-timeline">
          {[...doc.lessons]
            .sort((a, b) => (b.year ?? "").localeCompare(a.year ?? ""))
            .map((l, i) => (
              <li key={`${l.year}-${i}`}>
                <strong>{l.year ?? "Undated"}</strong> {l.text}
              </li>
            ))}
        </ol>
      );
    case "quotes":
      return doc.quotes.length === 0 ? (
        <p className="pf-unset">No quotes yet. The coach only ever uses yours.</p>
      ) : (
        <ul className="pf-quotes">
          {doc.quotes.map((q) => (
            <li key={q.text}>
              “{q.text}”{q.author && <span className="muted"> — {q.author}</span>}
            </li>
          ))}
        </ul>
      );
    case "additional_info":
      return <MoreInfo text={doc.additional_info} />;
  }
}

function HoldingsView({ page }: { page: ProfilePage }) {
  const rows = page.live.holdings;
  if (rows.length === 0)
    return <p className="pf-unset">No holdings listed. Add what you've put in, and where.</p>;
  return (
    <div className="pf-table-wrap">
      <table className="pf-table">
        <thead>
          <tr>
            <th scope="col">Holding</th>
            <th scope="col">Value from</th>
            <th scope="col" className="n">
              Invested
            </th>
            <th scope="col" className="n">
              Now
            </th>
            <th scope="col" className="n">
              Profit or loss
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => {
            const pnl = h.pnl_aud === null ? null : Number(h.pnl_aud);
            return (
              <tr key={`${h.name}-${i}`}>
                <td>
                  {h.name}
                  {!h.counts && <span className="pf-hint"> · not counted toward goals</span>}
                </td>
                <td className="muted">{CHOICE_WORDS[h.source ?? "manual"]}</td>
                <td className="n">{audText(h.invested_aud)}</td>
                <td className="n">{h.now_aud === null ? "—" : audText(h.now_aud)}</td>
                <td className={`n ${pnl === null ? "" : pnl >= 0 ? "up" : "down"}`}>
                  {pnl === null
                    ? "—"
                    : `${pnl >= 0 ? "▲ +" : "▼ −"}${audText(String(Math.abs(pnl)))}${
                        h.pnl_pct ? ` · ${h.pnl_pct}%` : ""
                      }`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!page.live.known && (
        <p className="pf-hint">Live values couldn't be read: Binance and wallet rows show —.</p>
      )}
    </div>
  );
}

function MoreInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return <p className="pf-unset">Not set.</p>;
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} notes
      </button>
      {open && <pre className="pf-more">{text}</pre>}
    </>
  );
}
