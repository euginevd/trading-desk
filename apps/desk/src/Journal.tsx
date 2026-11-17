// The Journal (decisions 56 and 66): every filled trade, the rules each broke (checked from the
// Profile), the owner's setup and mistake tags, and a 30-day score of rules kept. Said in a
// sentence, then the days as a strip of trades (mint kept, amber broke a rule), then the ledger.
import { useEffect, useState } from "react";
import { getJournal, setJournalLists, tagTrade } from "./api";
import { km } from "./Figures";
import { amount, aud, dateTime, price, shortDate } from "./format";
import type { JournalData, JournalEntry } from "./types";
import "./journal.css";

const DAY_MS = 86_400_000;
const STACK = 5; // dots shown a day; more say +n
const ROWS = 10; // trades shown before Show more, so the page fits one screen
const MORE = 20;
type Show = "all" | "broke" | "kept";

const sydneyDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

const SYDNEY = "Australia/Sydney";
const whenDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: SYDNEY });
const whenTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: SYDNEY,
  });

const said = (e: JournalEntry) =>
  `${e.side === "buy" ? "Bought" : "Sold"} ${amount(e.qty)} ${e.coin} at ${price(e.price)}, ${km(e.aud)}`;

const verdict = (e: JournalEntry) =>
  e.broke.length === 0 ? "kept every rule" : `broke ${e.broke.join(" and ").toLowerCase()}`;

export default function Journal() {
  const [data, setData] = useState<JournalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [show, setShow] = useState<Show>("all");
  const [lit, setLit] = useState<string | null>(null);
  const [rows, setRows] = useState(ROWS);
  useEffect(() => {
    getJournal().then(setData, (e: unknown) =>
      setError(e instanceof Error ? e.message : "The journal couldn't be read."),
    );
  }, []);
  if (error) {
    return (
      <main className="wrap jr">
        <p className="error-text" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="wrap jr">
        <p className="muted">Reading your trades…</p>
      </main>
    );
  }
  const s = data.score;
  const setEntry = (next: JournalEntry) =>
    setData({ ...data, entries: data.entries.map((e) => (e.key === next.key ? next : e)) });
  const shown = data.entries.filter(
    (e) => show === "all" || (show === "broke" ? e.broke.length > 0 : e.broke.length === 0),
  );
  const broke = data.entries.filter((e) => e.broke.length > 0).length;
  const visible = shown.slice(0, rows);
  const left = shown.length - visible.length;
  const filter = (next: Show) => {
    setShow(next);
    setRows(ROWS);
  };
  const jump = (key: string) => {
    setShow("all");
    setLit(key);
    const at = data.entries.findIndex((e) => e.key === key);
    if (at >= rows) setRows(Math.ceil((at + 1) / MORE) * MORE); // open far enough to show it
    window.setTimeout(() => {
      document.getElementById(`jr-${key}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
    window.setTimeout(() => setLit((now) => (now === key ? null : now)), 2400);
  };
  const top = s.mostBroken[0];
  const mistakeMoney = Number(s.withMistakeAud) !== 0 || Number(s.withoutMistakeAud) !== 0;
  return (
    <main className="wrap jr">
      <h1 className="visually-hidden">Journal</h1>
      <section className="jr-hero" aria-label="Your last 30 days">
        <h2 className="jr-headline">
          {s.trades === 0 ? (
            `No trades in the last ${s.days} days.`
          ) : (
            <>
              <span className="jr-kept">
                {s.kept} of {s.trades}
              </span>{" "}
              trades kept every rule in the last {s.days} days
              {s.keptPct !== null && <span className="jr-pct"> ({s.keptPct}%)</span>}.
            </>
          )}
        </h2>
        <p className="jr-lead">
          {top && (
            <>
              {top.what} broke it most, {top.times} time{top.times === 1 ? "" : "s"}
              {s.mostBroken.length > 1 &&
                `, then ${s.mostBroken
                  .slice(1)
                  .map((m) => `${m.what.charAt(0).toLowerCase()}${m.what.slice(1)} (${m.times})`)
                  .join(" and ")}`}
              .{" "}
            </>
          )}
          {mistakeMoney && (
            <>
              Realised with a mistake tag{" "}
              <span className={Number(s.withMistakeAud) < 0 ? "down" : "up"}>
                {km(s.withMistakeAud)}
              </span>
              , without{" "}
              <span className={Number(s.withoutMistakeAud) < 0 ? "down" : "up"}>
                {km(s.withoutMistakeAud)}
              </span>
              .
            </>
          )}
        </p>
      </section>

      <Strip entries={data.entries} days={s.days} onPick={jump} />

      <section className="jr-ledger" aria-label="Trades">
        <div className="jr-ledger-head">
          <h2>Trades</h2>
          <div className="views source-filter" role="group" aria-label="Show trades">
            {(
              [
                ["all", `All ${data.entries.length}`],
                ["broke", `Broke a rule ${broke}`],
                ["kept", `Kept ${data.entries.length - broke}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={show === key}
                onClick={() => filter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="empty">
            {data.entries.length === 0
              ? "No filled trades since 1 Jul 2026 yet."
              : show === "broke"
                ? "Every trade kept your rules."
                : "No trade kept every rule."}
          </p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Trade</th>
                  <th className="jr-from">From</th>
                  <th className="r">Size</th>
                  <th className="r">Result</th>
                  <th>Rules</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <Row
                    key={e.key}
                    entry={e}
                    lists={data.lists}
                    lit={lit === e.key}
                    onSaved={setEntry}
                  />
                ))}
              </tbody>
            </table>
            {(left > 0 || rows > ROWS) && (
              <div className="jr-more-row">
                {left > 0 && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setRows(rows + MORE)}
                  >
                    Show {Math.min(MORE, left)} more
                  </button>
                )}
                {rows > ROWS && (
                  <button type="button" className="link" onClick={() => setRows(ROWS)}>
                    Show fewer
                  </button>
                )}
                <span className="muted">
                  {visible.length} of {shown.length}
                </span>
              </div>
            )}
          </div>
        )}
        <p className="muted jr-note">
          Rules are checked from your Profile: a buy over your per-trade size, a coin over its cap
          (as it stands now), and deposits over your monthly cap that month. Mistake tags are yours.
        </p>
      </section>

      <Lists
        data={data}
        editing={editing}
        onEdit={setEditing}
        onSaved={(lists) => setData({ ...data, lists })}
      />
    </main>
  );
}

// The last days as a strip: a column a day, a dot a trade, mint kept and amber broke a rule.
// Move over a dot or focus it to read the trade; pick it to find its row.
function Strip({
  entries,
  days,
  onPick,
}: {
  entries: JournalEntry[];
  days: number;
  onPick: (key: string) => void;
}) {
  const [on, setOn] = useState<JournalEntry | null>(null);
  const [now] = useState(() => Date.now()); // the window ends today, as the page opened
  const columns = Array.from({ length: days }, (_, i) => {
    const day = sydneyDay(now - (days - 1 - i) * DAY_MS);
    return { day, trades: entries.filter((e) => sydneyDay(e.time) === day) };
  });
  const inWindow = columns.reduce((n, c) => n + c.trades.length, 0);
  if (inWindow === 0) return null;
  return (
    <section className="jr-strip" aria-label="Trades by day">
      <div className="jr-days" onPointerLeave={() => setOn(null)}>
        {columns.map((c, i) => {
          const more = c.trades.length - STACK;
          return (
            <div
              key={c.day}
              className="jr-day"
              style={{ "--i": i } as React.CSSProperties}
              title={`${shortDate(c.day)}: ${c.trades.length} trade${c.trades.length === 1 ? "" : "s"}`}
            >
              <div className="jr-dots">
                {c.trades.slice(0, STACK).map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    className={`jr-dot${e.broke.length ? " broke" : ""}${on?.key === e.key ? " on" : ""}`}
                    aria-label={`${shortDate(c.day)}: ${said(e)}, ${verdict(e)}`}
                    onPointerEnter={() => setOn(e)}
                    onFocus={() => setOn(e)}
                    onClick={() => onPick(e.key)}
                  />
                ))}
                {more > 0 && <span className="jr-more">+{more}</span>}
              </div>
              <span className="jr-date" aria-hidden="true">
                {i % 7 === (days - 1) % 7 ? shortDate(c.day).replace(/ \d{4}$/, "") : ""}
              </span>
            </div>
          );
        })}
      </div>
      <p className="jr-readout" key={on?.key ?? "idle"} aria-live="polite">
        {on
          ? `${dateTime(on.time)}: ${said(on)}. It ${verdict(on)}.`
          : "A dot a trade: mint kept every rule, amber broke one."}
      </p>
    </section>
  );
}

function Row({
  entry: e,
  lists,
  lit,
  onSaved,
}: {
  entry: JournalEntry;
  lists: JournalData["lists"];
  lit: boolean;
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
    <tr id={`jr-${e.key}`} className={lit ? "jr-lit" : undefined}>
      <td className="muted jr-when">
        {whenDay(e.time)} <span className="jr-time">{whenTime(e.time)}</span>
      </td>
      <td>
        <span className={`tag ${e.side}`}>{e.side === "buy" ? "Buy" : "Sell"}</span> {amount(e.qty)}{" "}
        {e.coin} <span className="muted">at</span> {price(e.price)}
      </td>
      <td className="muted jr-from">{e.from}</td>
      <td className="r num" title={aud(e.aud)}>
        {km(e.aud)}
      </td>
      <td
        className={`r num ${e.resultAud === null ? "muted" : Number(e.resultAud) < 0 ? "down" : "up"}`}
      >
        {e.resultAud === null ? (e.side === "buy" ? "Open" : "–") : km(e.resultAud)}
      </td>
      <td>
        {e.broke.length === 0 ? (
          <span className="jr-rule ok">Kept</span>
        ) : (
          e.broke.map((b) => (
            <span key={b} className="jr-rule broke">
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
    <section className="jr-lists" aria-labelledby="journal-lists">
      <h2 id="journal-lists">
        Your tags{" "}
        {!editing && (
          <button className="link" type="button" onClick={() => onEdit(true)}>
            Edit the lists
          </button>
        )}
      </h2>
      {editing ? (
        <div className="jr-lists-edit">
          <label className="plan-field">
            Setups, separated by commas
            <input value={setups} onChange={(e) => setSetups(e.target.value)} />
          </label>
          <label className="plan-field">
            Mistakes, separated by commas
            <input value={mistakes} onChange={(e) => setMistakes(e.target.value)} />
          </label>
          <div className="plan-save">
            <button type="button" className="btn btn-small" onClick={() => void save()}>
              Save tags
            </button>
            <button className="link" type="button" onClick={() => onEdit(false)}>
              Cancel
            </button>
            {note && <span className="error-text">{note}</span>}
          </div>
        </div>
      ) : (
        <div className="jr-lists-row">
          <span className="muted">Setups</span>
          <div>
            {data.lists.setups.map((t) => (
              <span key={t} className="jtag setup">
                {t}
              </span>
            ))}
          </div>
          <span className="muted">Mistakes</span>
          <div>
            {data.lists.mistakes.map((t) => (
              <span key={t} className="jtag mistake">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
