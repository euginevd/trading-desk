// A position's limits against today's price, for the Positions tables on the Trade page and the
// DCA book (owner, 21 Nov 2026): every row on one scale, in percent from now, so the same
// distance sits in the same place. "now" is a fixed line; each waiting limit is an amber tick
// labelled with how far under it is; filled buys are dots; the average is marked with its gap.
import { roundPrice } from "./dcaFormat";

export type StripScale = { lo: number; hi: number };

const pctOf = (price: number, now: number) => (price / now - 1) * 100;
const MAX_DOTS = 8; // more filled buys than this show as one band

// The scale for a table: from its deepest point to its highest, with room either side, never
// narrower than -10% to +3% so a calm table isn't stretched, and never wider than -40% to +25%.
export function scaleFor(rows: { now: number | null; prices: number[] }[]): StripScale {
  let lo = -10;
  let hi = 3;
  for (const r of rows) {
    if (!r.now) continue;
    for (const p of r.prices) {
      const pct = pctOf(p, r.now);
      lo = Math.min(lo, pct);
      hi = Math.max(hi, pct);
    }
  }
  // Capped, so years of buys far above or below today don't squeeze the rest; anything past
  // the edge sits on it.
  return { lo: Math.max(lo - 2, -40), hi: Math.min(hi + 2, 25) };
}

export function PctStrip({
  now,
  avg,
  fills,
  limits,
  scale,
}: {
  now: number | null;
  avg: number | null;
  fills: number[];
  limits: { price: number; spend: number }[];
  scale: StripScale;
}) {
  if (!now) return <span className="muted">No price yet</span>;
  const at = (pct: number) =>
    `${Math.min(100, Math.max(0, ((pct - scale.lo) / (scale.hi - scale.lo)) * 100))}%`;
  const avgPct = avg ? pctOf(avg, now) : null;
  const sorted = [...limits].sort((a, b) => b.price - a.price);
  const label = `Now ${roundPrice(now)}${avgPct !== null ? `, average ${avgPct >= 0 ? "+" : ""}${avgPct.toFixed(1)}%` : ""}; ${
    sorted.length
      ? `limits ${sorted.map((l) => `${pctOf(l.price, now).toFixed(1)}%`).join(", ")}`
      : "no limit waiting"
  }`;
  return (
    <span className="pcs num" role="img" aria-label={label}>
      <span className="pcs-line" />
      {avgPct !== null && (
        <span
          className={`pcs-gap ${avgPct > 0 ? "is-down" : "is-up"}`}
          style={{
            left: at(Math.min(0, avgPct)),
            width: `calc(${at(Math.max(0, avgPct))} - ${at(Math.min(0, avgPct))})`,
          }}
        />
      )}
      {fills.length > MAX_DOTS ? (
        // Many buys: their range as one band, lowest to highest, not a smear of dots.
        <span
          className="pcs-band"
          style={{
            left: at(pctOf(Math.min(...fills), now)),
            width: `calc(${at(pctOf(Math.max(...fills), now))} - ${at(pctOf(Math.min(...fills), now))})`,
          }}
        />
      ) : (
        fills.map((p, i) => (
          <span key={`f${i}`} className="pcs-fill" style={{ left: at(pctOf(p, now)) }} />
        ))
      )}
      {sorted.map((l, i) => (
        <span key={`l${i}`} className="pcs-lim" style={{ left: at(pctOf(l.price, now)) }}>
          <small>{Math.round(pctOf(l.price, now))}%</small>
        </span>
      ))}
      <span className="pcs-now" style={{ left: at(0) }} />
      {avgPct !== null && (
        <span className="pcs-avg" style={{ left: at(avgPct) }}>
          <small>
            avg {avgPct >= 0 ? "+" : ""}
            {avgPct.toFixed(1)}%
          </small>
        </span>
      )}
    </span>
  );
}

// The key under the column's name.
export function PctKey() {
  return (
    <span className="pcs-key">
      <i className="is-lim" /> limit <i className="is-fill" /> bought <i className="is-now" /> now
    </span>
  );
}
