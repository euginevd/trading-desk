// The Bots page (decision 68): every bot in one place. What they're doing in a sentence, a filter
// by type, then a section a type, each with its own table, bot pages and setup (their columns
// differ: a DCA bot's deals and safety orders, a grid's range and fills). Opening a bot or a setup
// gives it the screen. Rebalancing is next on TODO.md.
import { useCallback, useState } from "react";
import DcaBots from "./DcaBots";
import GridBots from "./GridBots";
import type { DcaBots as Dca, GridBots as Grids } from "./types";
import "./bots.css";

export type BotKind = "all" | "dca" | "grid";

const KINDS: [BotKind, string][] = [
  ["all", "All"],
  ["dca", "DCA"],
  ["grid", "Grid"],
];

const money = (v: number, quote: string, signed = false) =>
  `${signed && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${quote}`;

// What the bots are doing, in a sentence: how many run, how many are stopped, what they've made.
export function said(dca: Dca | null, grids: Grids | null): { head: string; lead: string } | null {
  if (!dca && !grids) return null;
  const all = [...(dca?.bots ?? []), ...(grids?.grids ?? [])];
  const quote = dca?.quote ?? grids?.quote ?? "USDC";
  if (all.length === 0)
    return {
      head: "No bots yet.",
      lead: "A DCA bot buys on a schedule or as the price falls; a grid trades the swings in a range.",
    };
  const on = all.filter((b) => b.enabled).length;
  const off = all.length - on;
  const made =
    (dca?.bots ?? []).reduce((s, b) => s + Number(b.profit), 0) +
    (grids?.grids ?? []).reduce((s, g) => s + Number(g.gridProfit), 0);
  const head =
    on === 0
      ? `${all.length} bot${all.length === 1 ? "" : "s"}, all stopped.`
      : `${on} bot${on === 1 ? "" : "s"} running${off ? `, ${off} stopped` : ""}.`;
  const lead =
    made === 0
      ? "Nothing realised yet."
      : `They've realised ${money(made, quote, true)} so far, before what they still hold.`;
  return { head, lead };
}

export default function BotsPage({
  kind,
  onKind,
}: {
  kind: BotKind;
  onKind: (k: BotKind) => void;
}) {
  const [dca, setDca] = useState<Dca | null>(null);
  const [grids, setGrids] = useState<Grids | null>(null);
  const [focus, setFocus] = useState<{ dca: boolean; grid: boolean }>({ dca: false, grid: false });
  const dcaEmbed = {
    onData: useCallback((d: Dca) => setDca(d), []),
    onFocus: useCallback((open: boolean) => setFocus((f) => ({ ...f, dca: open })), []),
  };
  const gridEmbed = {
    onData: useCallback((g: Grids) => setGrids(g), []),
    onFocus: useCallback((open: boolean) => setFocus((f) => ({ ...f, grid: open })), []),
  };
  const busy = focus.dca || focus.grid;
  const text = said(dca, grids);
  const tradingOff = (dca && !dca.tradingOn) || (grids && !grids.tradingOn);
  const showDca = (kind !== "grid" && !focus.grid) || focus.dca;
  const showGrid = (kind !== "dca" && !focus.dca) || focus.grid;
  return (
    <main className="wrap bots">
      <h1 className="visually-hidden">Bots</h1>
      {!busy && (
        <>
          <section className="bots-hero" aria-label="Your bots">
            <h2 className="bots-headline">{text?.head ?? "Reading your bots…"}</h2>
            {text && <p className="bots-lead">{text.lead}</p>}
          </section>
          <div className="bots-bar">
            <div className="views source-filter" role="group" aria-label="Show bots">
              {KINDS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={kind === key}
                  onClick={() => onKind(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {tradingOff && (
            <div className="alert notice" role="status">
              Trading is off, so bots stay stopped until you turn it on in the side panel.
            </div>
          )}
        </>
      )}
      {/* Both stay mounted while hidden, so a section keeps its place and refresh. */}
      <div hidden={!showDca}>
        <DcaBots embed={dcaEmbed} />
      </div>
      <div hidden={!showGrid}>
        <GridBots embed={gridEmbed} />
      </div>
    </main>
  );
}
