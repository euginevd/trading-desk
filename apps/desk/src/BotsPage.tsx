// The Bots page (decision 68): every bot in one place, after the exchanges' own bot pages. What
// the bots run and have made in a sentence; Running, Stopped and Coins; chips by type with their
// counts; each bot a block of its figures with its status and actions. A bot's own page and the
// setups stay with its type's code, which this page asks to open them. It shows one type at a
// time, as the Bots page's Opportunities (DCA) or Grid bots tab (BotsHome.tsx).
import { type ReactNode, useCallback, useRef, useState } from "react";
import { CreateMenu, useWatchCoins, type BotAsk, type BotHandle } from "./BotKit";
import CoinIcon from "./CoinIcon";
import DcaBots from "./DcaBots";
import { big } from "./format";
import GridBots from "./GridBots";
import type { DcaBot, DcaBots as Dca, GridBot, GridBots as Grids } from "./types";
import "./bots.css";

export type BotKind = "all" | "dca" | "grid";
type Tab = "running" | "stopped" | "coins";

const n = (v: string | number | null | undefined) =>
  v === null || v === undefined ? 0 : Number(v);
const fixed = (v: number) =>
  Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fixed(v)}`;
const tone = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "");

// How long a bot has run: 20h 9m, 4d 9h.
export function lasted(from: number | null, now: number): string {
  if (!from) return "";
  const m = Math.max(0, Math.floor((now - from) / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m % 60}m`;
}

const dcaRunning = (b: DcaBot) => b.enabled || b.deals.length > 0;
const gridRunning = (g: GridBot) => g.status === "running" || g.status === "finishing";

// One shape for both types, so the page lists them together.
interface Row {
  kind: "dca" | "grid";
  id: number;
  ref: string;
  pair: string;
  coin: string;
  running: boolean;
  status: { word: string; tone: string };
  started: number | null;
  invested: number;
  realised: number;
  floating: number;
  canChange: boolean; // edit and delete only while stopped and holding nothing
  facts: { label: string; value: ReactNode; tone?: string }[];
}

const DCA_STATUS: Record<DcaBot["status"], [string, string]> = {
  waiting: ["Waiting for entry", "on"],
  deal: ["In a deal", "on"],
  finishing: ["Finishing its deal", "wait"],
  paused: ["Paused", "wait"],
  off: ["Stopped", ""],
};
const GRID_STATUS: Record<GridBot["status"], [string, string]> = {
  running: ["Working", "on"],
  finishing: ["Finishing", "wait"],
  paused: ["Paused", "wait"],
  off: ["Stopped", ""],
};

function dcaRow(b: DcaBot, quote: string): Row {
  const floating = b.deals.reduce((s, d) => s + n(d.unrealised), 0);
  const deal = b.deals[0];
  const [word, t] = DCA_STATUS[b.status];
  const c = b.config;
  return {
    kind: "dca",
    id: b.id,
    ref: b.ref,
    pair: b.pair,
    coin: b.symbol.slice(0, -quote.length),
    running: dcaRunning(b),
    status: { word, tone: t },
    started: deal?.started ?? null,
    invested: n(b.maxBudget),
    realised: n(b.profit),
    floating,
    canChange: !b.enabled && b.deals.length === 0,
    facts: [
      { label: `Budget (${quote})`, value: fixed(n(b.maxBudget)) },
      {
        label: `Orders (${quote})`,
        value: `${fixed(n(c.baseOrder))} + ${c.maxDcaOrders} × ${fixed(n(c.dcaOrder))}`,
      },
      { label: "Take profit", value: `${c.takeProfit}%` },
      { label: `Realised (${quote})`, value: signed(n(b.profit)), tone: tone(n(b.profit)) },
      { label: `Floating (${quote})`, value: signed(floating), tone: tone(floating) },
      { label: "Deals closed", value: String(b.closed) },
      {
        label: "This deal",
        value: deal ? `${deal.filled} of ${deal.of} orders` : "None open",
      },
      { label: `Next buy (${quote})`, value: deal?.nextPrice ? big(String(deal.nextPrice)) : "–" },
      { label: `Last price (${quote})`, value: big(b.price === null ? null : String(b.price)) },
    ],
  };
}

function gridRow(g: GridBot, quote: string): Row {
  const [word, t] = GRID_STATUS[g.status];
  const c = g.config;
  const invested = n(c.investment);
  const pct = (v: number) => (invested ? ` · ${signed((v / invested) * 100)}%` : "");
  return {
    kind: "grid",
    id: g.id,
    ref: g.ref,
    pair: g.pair,
    coin: g.symbol.slice(0, -quote.length),
    running: gridRunning(g),
    status:
      g.status === "running" && !g.inRange
        ? { word: "Out of range", tone: "wait" }
        : { word, tone: t },
    started: g.started,
    invested,
    realised: n(g.gridProfit),
    floating: n(g.unrealised),
    canChange: g.status === "off" || g.status === "paused",
    facts: [
      { label: `Investment (${quote})`, value: fixed(invested) },
      { label: `Price range (${quote})`, value: `${big(c.lower)} – ${big(c.upper)}` },
      { label: "Grids", value: `${c.grids} ${c.spacing}` },
      {
        label: `Grid profit (${quote})`,
        value: `${signed(n(g.gridProfit))}${pct(n(g.gridProfit))}`,
        tone: tone(n(g.gridProfit)),
      },
      {
        label: `Floating (${quote})`,
        value: `${signed(n(g.unrealised))}${pct(n(g.unrealised))}`,
        tone: tone(n(g.unrealised)),
      },
      { label: "Round trips", value: String(g.trips) },
      { label: `Per order (${quote})`, value: fixed(n(c.perOrder)) },
      { label: "Open orders", value: `${g.openBuys} buys, ${g.openSells} sells` },
      { label: `Last price (${quote})`, value: big(g.price === null ? null : String(g.price)) },
    ],
  };
}

// What the bots run and have made, in a sentence.
export function said(rows: Row[], quote: string): { head: string; lead: string } {
  if (rows.length === 0)
    return {
      head: "No bots yet.",
      lead: "A DCA bot buys on a schedule or as the price falls; a grid trades the swings in a range.",
    };
  const on = rows.filter((r) => r.running);
  const off = rows.length - on.length;
  const total = rows.reduce((s, r) => s + r.realised + r.floating, 0);
  const realised = rows.reduce((s, r) => s + r.realised, 0);
  const head =
    on.length === 0
      ? `${rows.length} bot${rows.length === 1 ? "" : "s"}, all stopped.`
      : `${on.length} bot${on.length === 1 ? "" : "s"} running with ${fixed(
          on.reduce((s, r) => s + r.invested, 0),
        )} ${quote}${off ? `, ${off} stopped` : ""}.`;
  const lead =
    total === 0 && realised === 0
      ? "Nothing made or lost yet."
      : `${total >= 0 ? "Up" : "Down"} ${fixed(total)} ${quote} in all, ${signed(realised)} of it realised.`;
  return { head, lead };
}

export function toRows(dca: Dca | null, grids: Grids | null): Row[] {
  const quote = dca?.quote ?? grids?.quote ?? "USDC";
  return [
    ...(dca?.bots ?? []).map((b) => dcaRow(b, quote)),
    ...(grids?.grids ?? []).map((g) => gridRow(g, quote)),
  ];
}

export default function BotsPage({ only, note }: { only: "dca" | "grid"; note?: ReactNode }) {
  const kind: BotKind = only;
  const [dca, setDca] = useState<Dca | null>(null);
  const [grids, setGrids] = useState<Grids | null>(null);
  const [focus, setFocus] = useState<{ dca: boolean; grid: boolean }>({ dca: false, grid: false });
  const [picked, setTab] = useState<Tab | null>(null);
  const dcaHandle = useRef<BotHandle>(null);
  const gridHandle = useRef<BotHandle>(null);
  const [now] = useState(() => Date.now());
  const coins = useWatchCoins();
  const onDca = useCallback((d: Dca) => setDca(d), []);
  const onGrids = useCallback((g: Grids) => setGrids(g), []);
  const onDcaFocus = useCallback((open: boolean) => setFocus((f) => ({ ...f, dca: open })), []);
  const onGridFocus = useCallback((open: boolean) => setFocus((f) => ({ ...f, grid: open })), []);
  const ask = (type: "dca" | "grid", what: BotAsk) =>
    (type === "dca" ? dcaHandle : gridHandle).current?.act(what);

  const quote = dca?.quote ?? grids?.quote ?? "USDC";
  const rows = toRows(dca, grids).filter((r) => r.kind === only);
  // Opens on Running when a bot runs, else on Stopped, until a tab is picked.
  const tab: Tab = picked ?? (rows.some((r) => r.running) ? "running" : "stopped");
  const loaded = dca !== null || grids !== null;
  const text = said(rows, quote);
  const byKind = (k: BotKind) => rows.filter((r) => k === "all" || r.kind === k);
  const inTab = (r: Row) => (tab === "running" ? r.running : !r.running);
  const shown = byKind(kind).filter(inTab);
  const tradingOff = (dca && !dca.tradingOn) || (grids && !grids.tradingOn);
  const open = focus.dca || focus.grid;

  return (
    <main className="wrap bots">
      <h1 className="visually-hidden">Bots</h1>
      {!open && (
        <>
          <section className="bots-hero" aria-label="Your bots">
            <h2 className="bots-headline">{loaded ? text.head : "Reading your bots…"}</h2>
            {loaded && <p className="bots-lead">{text.lead}</p>}
          </section>
          {tradingOff && (
            <div className="alert notice" role="status">
              Trading is off, so bots stay stopped until you turn it on in the side panel.
            </div>
          )}
          <div className="bots-tabs" role="tablist" aria-label="Bots">
            {(
              [
                ["running", `Running ${rows.filter((r) => r.running).length}`],
                ["stopped", `Stopped ${rows.filter((r) => !r.running).length}`],
                ["coins", "Coins"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
            <span className="spacer" />
            {only === "dca" ? (
              <CreateMenu
                coins={coins}
                label="New DCA bot"
                onPick={(coin) => ask("dca", { kind: "new", coin })}
              />
            ) : (
              <CreateMenu
                coins={coins}
                label="New grid bot"
                onPick={(coin) => ask("grid", { kind: "new", coin })}
              />
            )}
          </div>
          {note}
          {tab === "coins" ? (
            <Coins dca={dca} grids={grids} kind={kind} quote={quote} />
          ) : !loaded ? (
            <div className="skeleton" style={{ height: 180 }} />
          ) : shown.length === 0 ? (
            <p className="bots-empty muted">
              {tab === "running" ? "No bots running." : "No stopped bots."}{" "}
              {rows.length === 0 &&
                (only === "dca" ? "Start one with New DCA bot." : "Start one with New grid bot.")}
            </p>
          ) : (
            <ul className="bots-list">
              {shown.map((r, i) => (
                <BotBlock
                  key={`${r.kind}-${r.id}`}
                  row={r}
                  i={i}
                  now={now}
                  onAsk={(k) => ask(r.kind, { kind: k, id: r.id })}
                />
              ))}
            </ul>
          )}
        </>
      )}
      {/* Each type keeps its bot pages, setups and switch-on dialog; in the list they show only
          an error or that dialog, and a bot or setup they open takes the screen. */}
      {!focus.grid && <DcaBots embed={{ onData: onDca, onFocus: onDcaFocus, handle: dcaHandle }} />}
      {!focus.dca && (
        <GridBots embed={{ onData: onGrids, onFocus: onGridFocus, handle: gridHandle }} />
      )}
    </main>
  );
}

function BotBlock({
  row: r,
  i,
  now,
  onAsk,
}: {
  row: Row;
  i: number;
  now: number;
  onAsk: (k: "open" | "edit" | "copy" | "toggle" | "delete") => void;
}) {
  const total = r.realised + r.floating;
  const pct = r.invested ? (total / r.invested) * 100 : null;
  return (
    <li className="bot-block" style={{ "--i": i } as React.CSSProperties}>
      <div className="bot-block-head">
        <CoinIcon coin={r.coin} />
        <b>{r.pair}</b>
        <span className="bot-type">{r.kind === "dca" ? "DCA" : "Grid"}</span>
        <span className="muted bot-ref">{r.ref}</span>
        <span className="spacer" />
        <button
          type="button"
          className={`bot-status ${r.status.tone}`}
          onClick={() => onAsk("open")}
        >
          {r.status.word}
          <span className="visually-hidden"> {r.pair}: open</span>
        </button>
      </div>
      <p className="bot-when muted">
        {r.started
          ? `Started ${new Date(r.started).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}, running ${lasted(r.started, now)}`
          : r.running
            ? "Waiting for its first buy"
            : "Not running"}
      </p>
      <div className="bot-total">
        <span className="muted">Total profit</span>
        <b className={`num ${tone(total)}`}>
          {signed(total)}
          {pct !== null && <small> {signed(pct)}%</small>}
        </b>
      </div>
      <dl className="bot-facts">
        {r.facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd className={`num ${f.tone ?? ""}`}>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="bot-actions">
        <button type="button" className="btn btn-small" onClick={() => onAsk("open")}>
          {r.kind === "dca" ? "Positions" : "Orders"}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={!r.canChange}
          onClick={() => onAsk("edit")}
        >
          Edit
        </button>
        <button type="button" className="btn btn-small" onClick={() => onAsk("copy")}>
          Copy
        </button>
        <button type="button" className="btn btn-small" onClick={() => onAsk("toggle")}>
          {r.running ? "Stop" : "Start"}
        </button>
        <button
          type="button"
          className="btn btn-small bot-delete"
          disabled={!r.canChange}
          onClick={() => onAsk("delete")}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

// What the bots hold, coin by coin: open DCA deals and what grids bought.
function Coins({
  dca,
  grids,
  kind,
  quote,
}: {
  dca: Dca | null;
  grids: Grids | null;
  kind: BotKind;
  quote: string;
}) {
  const held = new Map<string, { amount: number; value: number; bots: string[] }>();
  const add = (coin: string, amount: number, price: number, ref: string) => {
    if (amount <= 0) return;
    const now = held.get(coin) ?? { amount: 0, value: 0, bots: [] };
    held.set(coin, {
      amount: now.amount + amount,
      value: now.value + amount * price,
      bots: [...now.bots, ref],
    });
  };
  if (kind !== "grid")
    for (const b of dca?.bots ?? [])
      for (const d of b.deals) add(b.symbol.slice(0, -quote.length), n(d.held), n(b.price), b.ref);
  if (kind !== "dca")
    for (const g of grids?.grids ?? [])
      add(g.symbol.slice(0, -quote.length), n(g.held), n(g.price), g.ref);
  const list = [...held.entries()].sort((a, b) => b[1].value - a[1].value);
  if (list.length === 0)
    return <p className="bots-empty muted">The bots hold no coins right now.</p>;
  return (
    <ul className="bots-coins">
      {list.map(([coin, h]) => (
        <li key={coin}>
          <span className="coin">
            <CoinIcon coin={coin} />
            {coin}
          </span>
          <span className="num">
            {h.amount.toLocaleString("en-AU", { maximumSignificantDigits: 6 })}
          </span>
          <span className="num">
            {fixed(h.value)} {quote}
          </span>
          <span className="muted">{h.bots.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}
