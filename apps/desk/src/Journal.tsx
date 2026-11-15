// The Journal (decision 56): every filled trade, the rules each broke (checked from the
// Profile), the owner's setup and mistake tags, and a 30-day score of rules kept.
import { useEffect, useState } from "react";
import { getJournal, setJournalLists, tagTrade } from "./api";
import { amount, aud, dateTime, price } from "./format";
import type { JournalData, JournalEntry } from "./types";

export default function Journal() {
  const [data, setData] = useState<JournalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    getJournal().then(setData, (e: unknown) =>
      setError(e instanceof Error ? e.message : "The journal couldn't be read."),
    );
  }, []);
  if (error) {
    return (
      <main className="wrap journal">
        <p className="error-text" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="wrap journal">
        <p className="muted">Reading your trades…</p>
      </main>
    );
  }
  const s = data.score;
  const pct = Number(s.keptPct ?? 0);
  const setEntry = (next: JournalEntry) =>
    setData({ ...data, entries: data.entries.map((e) => (e.key === next.key ? next : e)) });
  return (
    <main className="wrap journal">
      <div className="journal-top">
        <section className="card journal-score" aria-labelledby="journal-score">
          <div
            className="journal-ring"
            style={{
              background: `conic-gradient(var(--accent) 0 ${pct}%, var(--panel-2) ${pct}% 100%)`,
            }}
          >
            <div>
              <b>{s.keptPct === null ? "–" : `${s.keptPct}%`}</b>
              <span className="muted">rules kept</span>
            </div>
          </div>
          <div>
            <h2 id="journal-score">Last {s.days} days</h2>
            <p>
              {s.trades} trade{s.trades === 1 ? "" : "s"} · {s.kept} kept every rule ·{" "}
              {s.trades - s.kept} didn&apos;t
            </p>
            {s.mostBroken.length > 0 && (
              <p className="muted">
                Broken most:{" "}
                {s.mostBroken.map((m, i) => (
                  <span key={m.what}>
                    {i > 0 && " · "}
                    <b>{m.what}</b> ({m.times})
                  </span>
                ))}
              </p>
            )}
            <p className="muted">
              Realised with a mistake tag:{" "}
              <span className={Number(s.withMistakeAud) < 0 ? "down" : "up"}>
                {aud(s.withMistakeAud)}
              </span>{" "}
              · without:{" "}
              <span className={Number(s.withoutMistakeAud) < 0 ? "down" : "up"}>
                {aud(s.withoutMistakeAud)}
              </span>
            </p>
          </div>
        </section>
        <Lists
          data={data}
          editing={editing}
          onEdit={setEditing}
          onSaved={(lists) => setData({ ...data, lists })}
        />
      </div>
      <section className="card journal-table" aria-label="Trades">
        {data.entries.length === 0 ? (
          <p className="empty">No filled trades since 1 Jul 2026 yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Trade</th>
                  <th>From</th>
                  <th className="r">Size</th>
                  <th className="r">Result</th>
                  <th>Rules</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <Row key={e.key} entry={e} lists={data.lists} onSaved={setEntry} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted journal-note">
          Rules are checked from your Profile: a buy over your per-trade size, a coin over its cap
          (as it stands now), and deposits over your monthly cap that month. Mistake tags are yours.
        </p>
      </section>
    </main>
  );
}

function Row({
  entry: e,
  lists,
  onSaved,
}: {
  entry: JournalEntry;
  lists: JournalData["lists"];
  onSaved: (e: JournalEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (kind: "setups" | "mistakes", tag: string) => {
    const now = e[kind].includes(tag) ? e[kind].filter((t) => t !== tag) : [...e[kind], tag];
    const next = { ...e, [kind]: now };
    tagTrade(e.key, next.setups, next.mistakes).then(
      (saved) => onSaved({ ...e, ...saved }),
      () => undefined,
    );
  };
  return (
    <tr>
      <td className="muted">{dateTime(e.time)}</td>
      <td>
        <span className={`tag ${e.side}`}>{e.side === "buy" ? "Buy" : "Sell"}</span> {amount(e.qty)}{" "}
        {e.coin} @ {price(e.price)}
      </td>
      <td className="muted">{e.from}</td>
      <td className="r num">{aud(e.aud)}</td>
      <td
        className={`r num ${e.resultAud === null ? "muted" : Number(e.resultAud) < 0 ? "down" : "up"}`}
      >
        {e.resultAud === null ? (e.side === "buy" ? "open" : "–") : aud(e.resultAud)}
      </td>
      <td>
        {e.broke.length === 0 ? (
          <span className="tax-pill ok">Kept</span>
        ) : (
          e.broke.map((b) => (
            <span key={b} className="tax-pill warn">
              {b}
            </span>
          ))
        )}
      </td>
      <td className="journal-tags">
        {e.setups.map((t) => (
          <span key={t} className="jtag setup">
            {t}
          </span>
        ))}
        {e.mistakes.map((t) => (
          <span key={t} className="jtag mistake">
            {t}
          </span>
        ))}
        <button className="link" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Done" : "+ tag"}
        </button>
        {open && (
          <div className="journal-picker" role="group" aria-label={`Tags for ${e.coin} ${e.side}`}>
            {(["setups", "mistakes"] as const).map((kind) =>
              lists[kind].map((t) => (
                <button
                  key={`${kind}-${t}`}
                  type="button"
                  className={`jtag ${kind === "setups" ? "setup" : "mistake"}${e[kind].includes(t) ? " on" : ""}`}
                  aria-pressed={e[kind].includes(t)}
                  onClick={() => toggle(kind, t)}
                >
                  {t}
                </button>
              )),
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function Lists({
  data,
  editing,
  onEdit,
  onSaved,
}: {
  data: JournalData;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onSaved: (lists: JournalData["lists"]) => void;
}) {
  const [setups, setSetups] = useState(data.lists.setups.join(", "));
  const [mistakes, setMistakes] = useState(data.lists.mistakes.join(", "));
  const [note, setNote] = useState("");
  const split = (v: string) =>
    v
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  const save = () =>
    setJournalLists(split(setups), split(mistakes)).then(
      (lists) => {
        onSaved(lists);
        onEdit(false);
        setNote("");
      },
      (e: unknown) => setNote(e instanceof Error ? e.message : "Not saved."),
    );
  return (
    <section className="card journal-lists" aria-labelledby="journal-lists">
      <h2 id="journal-lists">
        Your tags{" "}
        {!editing && (
          <button className="link" type="button" onClick={() => onEdit(true)}>
            Edit the lists
          </button>
        )}
      </h2>
      {editing ? (
        <>
          <label className="plan-field">
            Setups, separated by commas
            <input value={setups} onChange={(e) => setSetups(e.target.value)} />
          </label>
          <label className="plan-field">
            Mistakes, separated by commas
            <input value={mistakes} onChange={(e) => setMistakes(e.target.value)} />
          </label>
          <div className="plan-save">
            <button type="button" onClick={() => void save()}>
              Save tags
            </button>
            <button className="link" type="button" onClick={() => onEdit(false)}>
              Cancel
            </button>
            {note && <span className="error-text">{note}</span>}
          </div>
        </>
      ) : (
        <>
          <p className="muted">Setups</p>
          <div>
            {data.lists.setups.map((t) => (
              <span key={t} className="jtag setup">
                {t}
              </span>
            ))}
          </div>
          <p className="muted">Mistakes</p>
          <div>
            {data.lists.mistakes.map((t) => (
              <span key={t} className="jtag mistake">
                {t}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
