// The Portfolio's three tabs, each with only its own figures (owner, 22 Nov 2026): four widgets
// in the Trade page's tile style, then an Allocation donut of the tab's coins. All sums the
// account; Binance has its cash and orders; the Ledger its staking, custody and reads.
import { useState } from "react";
import { Live } from "./Figures";
import type { Money } from "./money";
import { km } from "./Figures";
import type { Drift, DriftRow, Holding, Portfolio as Data } from "./types";

type Source = "all" | Holding["source"];
const STABLES = new Set(["USDT", "USDC", "FDUSD"]);
// Profile 5.3.2: the 2026 coins, 70% or more of them on the Ledger (Risk page, decision 79).
const COINS_2026 = new Set(["BTC", "ETH", "SOL", "ZEC", "HYPE"]);
const COLD_MIN = 70;

// Six hues checked on the desk's dark surface (lightness, chroma, colour-blind and normal-vision
// separation, 3:1 contrast), in a fixed order; a coin keeps its colour across the three tabs
// because it's given by the coin's rank in the whole account, not in the tab.
const HUES = ["#2a9d8f", "#3987e5", "#c98500", "#d55181", "#9085e9", "#d95926"];
const OTHER = "#4b6470";
const SMALL = 1; // coins under 1% of the tab share one "more" slice

const sum = (hs: Holding[]) => hs.reduce((s, h) => s + Number(h.value ?? 0), 0);
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "");
const pct = (n: number) =>
  n > 0 && n < 0.1 ? "<0.1%" : `${n >= 10 || n === 0 ? Math.round(n) : n.toFixed(1)}%`;
const at = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

function Tile({
  label,
  value,
  live,
  className = "",
  children,
}: {
  label: string;
  value: string;
  live?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={`num ${className}`}>{live ? <Live value={live}>{value}</Live> : value}</dd>
      {children}
    </div>
  );
}

function Split({ parts }: { parts: [string, number][] }) {
  const whole = parts.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <span className="port-split" aria-hidden="true">
      {parts.map(([k, v]) => (
        <i key={k} className={`is-${k}`} style={{ width: `${(v / whole) * 100}%` }} />
      ))}
    </span>
  );
}

function AllTiles({ data, m }: { data: Data; m: Money }) {
  const onLedger = sum(data.holdings.filter((h) => h.source === "Ledger"));
  const total = Number(data.total.value);
  const onBinance = total - onLedger;
  const profit = Number(data.total.profit);
  const change = Number(data.total.change24h);
  const coins = new Set(data.holdings.filter((h) => Number(h.value ?? 0) >= 5).map((h) => h.asset));
  return (
    <dl className="port-tiles" aria-label="The whole account">
      <Tile label="Value" value={m.short(total)} live={data.total.value}>
        <small className="port-sub">{coins.size} coins, Binance and the Ledger</small>
      </Tile>
      <Tile label="Profit and loss" value={m.short(profit, true)} className={tone(profit)}>
        <small className="port-sub">
          {data.total.profitPercent !== null &&
            `${Number(data.total.profitPercent) >= 0 ? "+" : "−"}${pct(Math.abs(Number(data.total.profitPercent)))} on `}
          {m.short(data.total.cost)} paid
        </small>
      </Tile>
      <Tile label="On the Ledger" value={total ? pct((onLedger / total) * 100) : "–"}>
        <Split
          parts={[
            ["ledger", onLedger],
            ["binance", onBinance],
          ]}
        />
        <small className="port-sub">
          {m.short(onLedger)} Ledger · {m.short(onBinance)} Binance
        </small>
      </Tile>
      <Tile label="Today" value={m.short(change, true)} className={tone(change)}>
        <small className="port-sub">
          {data.total.change24hPercent === null
            ? "over 24 hours"
            : `${change >= 0 ? "+" : "−"}${pct(Math.abs(Number(data.total.change24hPercent)))} over 24 hours`}
        </small>
      </Tile>
    </dl>
  );
}

function BinanceTiles({ data, m }: { data: Data; m: Money }) {
  const mine = data.holdings.filter((h) => h.source !== "Ledger");
  const value = sum(mine);
  const profit = mine.reduce((s, h) => s + Number(h.profit ?? 0), 0);
  const cash = sum(mine.filter((h) => STABLES.has(h.asset)));
  const quote = (symbol: string) => [...STABLES].some((q) => symbol.endsWith(q));
  const buys = data.openOrders.filter((o) => o.side === "Buy");
  const inBuys = buys
    .filter((o) => quote(o.symbol))
    .reduce((s, o) => s + (Number(o.amount) - Number(o.filled)) * Number(o.price), 0);
  const coins = new Set(mine.filter((h) => Number(h.value ?? 0) >= 5).map((h) => h.asset));
  return (
    <dl className="port-tiles" aria-label="Binance">
      <Tile label="On Binance" value={m.short(value)} live={String(value)}>
        <small className="port-sub">{coins.size} coins and cash</small>
      </Tile>
      <Tile label="Profit and loss" value={m.short(profit, true)} className={tone(profit)}>
        <small className="port-sub">on Binance&apos;s coins with a cost</small>
      </Tile>
      <Tile label="Cash" value={m.short(cash)}>
        <Split
          parts={[
            ["free", Math.max(cash - inBuys, 0)],
            ["held", Math.min(inBuys, cash)],
          ]}
        />
        <small className="port-sub">
          {m.short(Math.max(cash - inBuys, 0))} free · {m.short(inBuys)} in buy orders
        </small>
      </Tile>
      <Tile label="Open orders" value={String(data.openOrders.length)}>
        <small className="port-sub">
          {buys.length} buy{buys.length === 1 ? "" : "s"} · {data.openOrders.length - buys.length}{" "}
          sell{data.openOrders.length - buys.length === 1 ? "" : "s"}
        </small>
      </Tile>
    </dl>
  );
}

function LedgerTiles({ data, m }: { data: Data; m: Money }) {
  const mine = data.holdings.filter((h) => h.source === "Ledger");
  const value = sum(mine);
  const profit = mine.reduce((s, h) => s + Number(h.profit ?? 0), 0);
  const tao = data.wallets.tao;
  const ledger = data.wallets.ledger;
  const coins = (hs: Holding[]) => sum(hs.filter((h) => COINS_2026.has(h.asset)));
  const cold = coins(mine);
  const all2026 = coins(data.holdings);
  const coldPct = all2026 ? (cold / all2026) * 100 : 0;
  const failed =
    ledger?.status === "connected" || ledger?.status === "error"
      ? (ledger.failedNetworks ?? [])
      : [];
  const stale = ledger?.status === "connected" ? (ledger.staleNetworks ?? []) : [];
  const read = ledger && "addresses" in ledger ? (ledger.addresses ?? 0) : 0;
  const readAt = ledger && "readAt" in ledger && ledger.readAt ? at(ledger.readAt) : null;
  const trouble = failed.length > 0 || ledger?.status === "error";
  return (
    <dl className="port-tiles" aria-label="The Ledger">
      <Tile label="On the Ledger" value={m.short(value)} live={String(value)}>
        <small className={`port-sub ${tone(profit)}`}>
          {m.short(profit, true)} against what it cost
          {trouble ? " · part couldn't be read" : ""}
        </small>
      </Tile>
      <Tile
        label="TAO staked"
        value={tao.status === "connected" ? `${Number(tao.staked).toFixed(1)} τ` : "–"}
      >
        <small className="port-sub">
          {tao.status === "connected"
            ? `${Number(tao.rewards ?? 0).toFixed(2)} τ to claim · ${Number(tao.free).toFixed(2)} τ free`
            : tao.status === "error"
              ? "Taostats couldn't be read"
              : "Add TAO_COLDKEY to .env"}
        </small>
      </Tile>
      <Tile
        label="2026 coins here"
        value={all2026 ? pct(coldPct) : "–"}
        className={all2026 ? (coldPct >= COLD_MIN ? "up" : "down") : ""}
      >
        <small className="port-sub">
          BTC, ETH, SOL, ZEC and HYPE · your rule {COLD_MIN}% or more
        </small>
      </Tile>
      <Tile
        label="Addresses read"
        value={
          ledger && ledger.status !== "not_set" ? `${read - failed.length} of ${read}` : "None"
        }
        className={trouble ? "down" : ""}
      >
        <small className={`port-sub${trouble || stale.length ? " port-warn" : ""}`}>
          {!ledger || ledger.status === "not_set" ? (
            <a href="#/settings">Add your addresses in Settings</a>
          ) : trouble ? (
            <>
              {(failed.length ? failed : ["The Ledger"]).join(", ")} didn&apos;t answer ·{" "}
              <a href="#/settings">Settings</a>
            </>
          ) : stale.length ? (
            `${stale.join(", ")} as last read${readAt ? ` at ${readAt}` : ""}`
          ) : (
            `plus TAO by Taostats${readAt ? ` · read ${readAt}` : ""}`
          )}
        </small>
      </Tile>
    </dl>
  );
}

export function Widgets({ data, source, m }: { data: Data; source: Source; m: Money }) {
  if (source === "Binance") return <BinanceTiles data={data} m={m} />;
  if (source === "Ledger") return <LedgerTiles data={data} m={m} />;
  return <AllTiles data={data} m={m} />;
}

interface Slice {
  key: string;
  label: string;
  value: number;
  share: number;
  colour: string;
  target: number | null;
  row: DriftRow | null;
}

// Each coin's colour, from its rank by value in the whole account: the top six take a hue, the
// rest share the neutral, so a coin looks the same on every tab.
export function coinColours(all: Holding[]): Map<string, string> {
  const byCoin = new Map<string, number>();
  for (const h of all) {
    if (!STABLES.has(h.asset))
      byCoin.set(h.asset, (byCoin.get(h.asset) ?? 0) + Number(h.value ?? 0));
  }
  const ranked = [...byCoin.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return new Map(ranked.map((c, i) => [c, HUES[i] ?? OTHER]));
}

const R = 70; // the ring's radius in the 180-wide view box
const RING = 2 * Math.PI * R;
const GAP = 2; // a 2px surface gap between slices

// The tab's coins as a donut: the centre reads the whole, or the slice you point at; the legend
// names every slice with its share and value, and its target gap where the Profile sets one.
export function Allocation({
  holdings,
  all,
  drift,
  m,
}: {
  holdings: Holding[];
  all: Holding[];
  drift: Drift | null;
  m: Money;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const colours = coinColours(all);
  const byCoin = new Map<string, number>();
  for (const h of holdings) {
    const v = Number(h.value ?? 0);
    if (v > 0) byCoin.set(h.asset, (byCoin.get(h.asset) ?? 0) + v);
  }
  const whole = [...byCoin.values()].reduce((a, b) => a + b, 0);
  if (whole <= 0) return null;
  const rows = new Map((drift?.hasTargets ? drift.rows : []).map((r) => [r.coin, r]));
  const targets = new Map([...rows.values()].map((r) => [r.coin, Number(r.targetPct)]));
  const slices: Slice[] = [];
  const small: string[] = [];
  for (const [coin, value] of [...byCoin.entries()].sort((a, b) => b[1] - a[1])) {
    const share = (value / whole) * 100;
    if (share < SMALL && !targets.has(coin)) {
      small.push(coin);
      continue;
    }
    const colour = STABLES.has(coin) ? OTHER : (colours.get(coin) ?? OTHER);
    slices.push({
      key: coin,
      label: coin,
      value,
      share,
      colour,
      target: targets.get(coin) ?? null,
      row: rows.get(coin) ?? null,
    });
  }
  if (small.length) {
    const value = small.reduce((s, c) => s + (byCoin.get(c) ?? 0), 0);
    slices.push({
      key: "more",
      label: `${small.length} more`,
      value,
      share: (value / whole) * 100,
      colour: OTHER,
      target: null,
      row: null,
    });
  }
  const shown = slices.find((s) => s.key === picked) ?? null;
  let start = 0;
  return (
    <section className="port-box port-alloc" aria-labelledby="port-alloc-title">
      <h2 id="port-alloc-title">Allocation</h2>
      <div className="port-alloc-body">
        <svg
          viewBox="0 0 180 180"
          className="port-donut"
          role="img"
          aria-label="Allocation by coin"
        >
          {slices.map((s) => {
            const length = (s.share / 100) * RING;
            const dash = Math.max(length - GAP, 0.5);
            const offset = -start;
            start += length;
            return (
              <circle
                key={s.key}
                cx="90"
                cy="90"
                r={R}
                fill="none"
                stroke={s.colour}
                strokeWidth={picked === s.key ? 22 : 18}
                strokeDasharray={`${dash} ${RING - dash}`}
                strokeDashoffset={offset}
                transform="rotate(-90 90 90)"
                className="port-arc"
                tabIndex={0}
                aria-label={`${s.label}: ${pct(s.share)}, ${m.whole(s.value)}`}
                onMouseEnter={() => setPicked(s.key)}
                onMouseLeave={() => setPicked(null)}
                onFocus={() => setPicked(s.key)}
                onBlur={() => setPicked(null)}
                onClick={() => setPicked((p) => (p === s.key ? null : s.key))}
              />
            );
          })}
          <text x="90" y="86" textAnchor="middle" className="port-donut-big num">
            {shown ? pct(shown.share) : m.short(whole)}
          </text>
          <text x="90" y="106" textAnchor="middle" className="port-donut-small">
            {shown ? `${shown.label} · ${m.short(shown.value)}` : `${byCoin.size} coins`}
          </text>
        </svg>
        <ul className="port-legend">
          {slices.map((s) => (
            <li
              key={s.key}
              className={picked === s.key ? "is-picked" : ""}
              onMouseEnter={() => setPicked(s.key)}
              onMouseLeave={() => setPicked(null)}
            >
              <i style={{ background: s.colour }} aria-hidden="true" />
              <span className="port-legend-coin">{s.label}</span>
              <span className="num">{pct(s.share)}</span>
              <span className="num muted">{m.short(s.value)}</span>
              {s.target !== null && (
                <span className="num muted port-legend-target">
                  target {pct(s.target)}
                  {Math.abs(s.share - s.target) >= 1 &&
                    ` · ${Math.round(Math.abs(s.share - s.target))} pts ${s.share > s.target ? "over" : "under"}`}
                </span>
              )}
              {/* Out of its band: the one order that moves it back, filled in on the DCA book
                  for you to check (decision 55); nothing is sent from here. */}
              {s.row?.outside && s.row.side && (
                <a
                  className="port-legend-act"
                  href={`#/dca-book?coin=${s.row.coin}&rebalance=${s.row.side}&price=${s.row.price ?? ""}&qty=${s.row.qty ?? ""}`}
                  title={
                    s.row.capped
                      ? `${km(s.row.toTargetAud ?? null)} to reach the target; one order of your per-trade size at a time`
                      : undefined
                  }
                >
                  {s.row.side === "sell" ? "Trim" : "Add"} {km(s.row.orderAud ?? null)}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
