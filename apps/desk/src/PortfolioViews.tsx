// The Portfolio's three tabs, each with only its own figures (owner, 22 Nov 2026): four widgets
// in the Trade page's tile style, then Allocation and the tab's second box, one size. All sums the
// account; Binance has its cash and orders; the Ledger its staking, custody and reads.
import { useState } from "react";
import { Live } from "./Figures";
import type { Money } from "./money";
import { km } from "./Figures";
import type { Drift, Holding, Portfolio as Data } from "./types";

type Source = "all" | Holding["source"];
const STABLES = new Set(["USDT", "USDC", "FDUSD"]);
// Profile 5.3.2: the 2026 coins, 70% or more of them on the Ledger (Risk page, decision 79).
const COINS_2026 = new Set(["BTC", "ETH", "SOL", "ZEC", "HYPE"]);
const COLD_MIN = 70;
const CUSTODY_ROWS = 6; // and a "more" line: seven, as Allocation shows

// Six hues checked on the desk's dark surface (lightness, chroma, colour-blind and normal-vision
// separation, 3:1 contrast), given in this order to a tab's six largest coins.
const HUES = ["#2a9d8f", "#3987e5", "#c98500", "#d55181", "#9085e9", "#d95926"];
const OTHER = "#4b6470";

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
}

const R = 70; // the ring's radius in the 180-wide view box
const RING = 2 * Math.PI * R;
const GAP = 2; // a 2px surface gap between slices

// The tab's coins as a donut: the six largest take a hue each (by rank in this tab, so no two
// slices share a colour), the rest one "more" slice; the centre reads the whole, or the slice
// you point at.
export function Allocation({ holdings, m }: { holdings: Holding[]; m: Money }) {
  const [picked, setPicked] = useState<string | null>(null);
  const byCoin = new Map<string, number>();
  for (const h of holdings) {
    const v = Number(h.value ?? 0);
    if (v > 0) byCoin.set(h.asset, (byCoin.get(h.asset) ?? 0) + v);
  }
  const whole = [...byCoin.values()].reduce((a, b) => a + b, 0);
  if (whole <= 0) return null;
  const ranked = [...byCoin.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.length > HUES.length + 1 ? ranked.slice(0, HUES.length) : ranked;
  const slices: Slice[] = top.map(([coin, value], i) => ({
    key: coin,
    label: coin,
    value,
    share: (value / whole) * 100,
    colour: HUES[i] ?? OTHER,
  }));
  const rest = ranked.slice(top.length);
  if (rest.length) {
    const value = rest.reduce((t, [, v]) => t + v, 0);
    slices.push({
      key: "more",
      label: `${rest.length} more`,
      value,
      share: (value / whole) * 100,
      colour: OTHER,
    });
  }
  const shown = slices.find((x) => x.key === picked) ?? null;
  // Where each slice starts round the ring: the shares before it.
  const starts = slices.map((_, i) =>
    slices.slice(0, i).reduce((t, x) => t + (x.share / 100) * RING, 0),
  );
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
          {slices.map((x, i) => {
            const dash = Math.max((x.share / 100) * RING - GAP, 0.5);
            const offset = -(starts[i] ?? 0);
            return (
              <circle
                key={x.key}
                cx="90"
                cy="90"
                r={R}
                fill="none"
                stroke={x.colour}
                strokeWidth={picked === x.key ? 22 : 18}
                strokeDasharray={`${dash} ${RING - dash}`}
                strokeDashoffset={offset}
                transform="rotate(-90 90 90)"
                className="port-arc"
                tabIndex={0}
                aria-label={`${x.label}: ${pct(x.share)}, ${m.whole(x.value)}`}
                onMouseEnter={() => setPicked(x.key)}
                onMouseLeave={() => setPicked(null)}
                onFocus={() => setPicked(x.key)}
                onBlur={() => setPicked(null)}
                onClick={() => setPicked((k) => (k === x.key ? null : x.key))}
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
          {slices.map((x) => (
            <li
              key={x.key}
              className={picked === x.key ? "is-picked" : ""}
              onMouseEnter={() => setPicked(x.key)}
              onMouseLeave={() => setPicked(null)}
            >
              <i style={{ background: x.colour }} aria-hidden="true" />
              <span className="port-legend-coin">{x.label}</span>
              <span className="num">{pct(x.share)}</span>
              <span className="num muted">{m.short(x.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// All's second box: each Profile target against where the coin is now, the bar its share and
// the tick its target, with the one order that moves it back when it's out of its band, filled
// in on the DCA book for you to check (decision 55); nothing is sent from here.
export function Targets({ drift }: { drift: Drift | null | false }) {
  const rows = drift && drift.hasTargets ? drift.rows : [];
  const top = Math.max(1, ...rows.flatMap((r) => [Number(r.targetPct), Number(r.nowPct)]));
  return (
    <section className="port-box port-targets" aria-labelledby="port-targets-title">
      <h2 id="port-targets-title">
        Targets {drift && drift.hasTargets && <span className="muted">±{drift.band} pts band</span>}
      </h2>
      {drift === null ? (
        <p className="muted">Loading…</p>
      ) : drift === false ? (
        <p className="muted">Your targets couldn&apos;t be read. The page tries again shortly.</p>
      ) : !rows.length ? (
        <p className="muted">
          No targets yet. <a href="#/profile">Set them on the Profile</a>
        </p>
      ) : (
        <ul className="port-target-list">
          {rows.map((r) => {
            const now = Number(r.nowPct);
            const target = Number(r.targetPct);
            return (
              <li key={r.coin}>
                <span className="port-legend-coin">{r.coin}</span>
                <span className="port-target-bar" aria-hidden="true">
                  <span
                    className={r.outside ? "is-out" : ""}
                    style={{ width: `${(now / top) * 100}%` }}
                  />
                  <i style={{ left: `${(target / top) * 100}%` }} />
                </span>
                <span className="num">
                  {pct(now)} <span className="muted">of {pct(target)}</span>
                </span>
                {r.outside && r.side ? (
                  <a
                    className="port-legend-act"
                    href={`#/dca-book?coin=${r.coin}&rebalance=${r.side}&price=${r.price ?? ""}&qty=${r.qty ?? ""}`}
                    title={
                      r.capped
                        ? `${km(r.toTargetAud ?? null)} to reach the target; one order of your per-trade size at a time`
                        : undefined
                    }
                  >
                    {r.side === "sell" ? "Trim" : "Add"} {km(r.orderAud ?? null)}
                  </a>
                ) : (
                  <span className={`port-target-ok ${r.outside ? "wait" : "muted"}`}>
                    {r.outside ? "Out of band" : "In band"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The Ledger's second box: for each coin on it, how much of that coin is here rather than on
// Binance, least moved first, so what's left to move shows at a glance; seven rows at most, to
// match Allocation beside it. A share rounds down: 100% only when nothing is left on Binance.
export function Custody({ parts, m }: { parts: Holding[]; m: Money }) {
  const coins = new Map<string, { ledger: number; binance: number }>();
  for (const h of parts) {
    if (STABLES.has(h.asset)) continue;
    const c = coins.get(h.asset) ?? { ledger: 0, binance: 0 };
    if (h.source === "Ledger") c.ledger += Number(h.value ?? 0);
    else c.binance += Number(h.value ?? 0);
    coins.set(h.asset, c);
  }
  const rows = [...coins.entries()]
    .filter(([, c]) => c.ledger > 0)
    .map(([coin, c]) => ({
      coin,
      ...c,
      share: c.binance < 1 ? 100 : (c.ledger / (c.ledger + c.binance)) * 100,
    }))
    .sort((a, b) => a.share - b.share);
  const shown = rows.length > CUSTODY_ROWS + 1 ? rows.slice(0, CUSTODY_ROWS) : rows;
  const rest = rows.length - shown.length;
  return (
    <section className="port-box port-custody" aria-labelledby="port-custody-title">
      <h2 id="port-custody-title">
        Custody <span className="muted">share of each coin here</span>
      </h2>
      {!rows.length ? (
        <p className="muted">No coins on the Ledger yet.</p>
      ) : (
        <ul className="port-target-list">
          {shown.map(({ coin, binance, share }) => (
            <li key={coin} className={COINS_2026.has(coin) && share < COLD_MIN ? "is-low" : ""}>
              <span className="port-legend-coin">{coin}</span>
              <span className="port-target-bar" aria-hidden="true">
                <span style={{ width: `${share}%` }} />
              </span>
              <span className="num">{Math.floor(share)}%</span>
              {COINS_2026.has(coin) && share < COLD_MIN ? (
                <span className="num port-target-ok wait">Under {COLD_MIN}%</span>
              ) : (
                <span className="num muted port-target-ok">
                  {binance >= 1 ? `${m.short(binance)} left` : "All here"}
                </span>
              )}
            </li>
          ))}
          {rest > 0 && (
            <li className="port-target-more muted">
              {rest} more, each {Math.floor(rows[CUSTODY_ROWS]?.share ?? 0)}% or more here
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
