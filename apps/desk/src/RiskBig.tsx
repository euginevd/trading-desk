// The four big risks on the Risk page (decision 79, docs/mockups/risk.html): money on Binance,
// the 2026 coins on the Ledger, TAO's share with its glide path and a what-if trim, and the
// Ledger backup. Ranked cards that open for detail; the figures are the desk's own.
import { useState, type CSSProperties } from "react";
import CoinIcon from "./CoinIcon";
import { day } from "./dcaFormat";
import type { RiskBackup, RiskCold, RiskExchange, RiskLimit, RiskTao } from "./types";

const LABEL = {
  "big-exchange": { kept: "Kept", near: "Near", broken: "Over" },
  "big-cold": { kept: "Kept", near: "Near", broken: "Under" },
  "big-tao": { kept: "Kept", near: "Watch", broken: "Off path" },
  "big-backup": { kept: "Current", near: "Due", broken: "Not done" },
} as const;

export function aud(value: string | number | null | undefined): string {
  const n = Math.round(Number(value ?? 0));
  return `${n < 0 ? "−" : ""}A$${Math.abs(n).toLocaleString("en-AU")}`;
}

function Meter({ row }: { row: RiskLimit }) {
  const value = Number(row.value);
  const mark = row.limit === null ? null : Number(row.limit);
  // The exchange is in dollars: the scale runs past both the figure and the cap.
  const top = row.key === "big-exchange" ? Math.max(value, mark ?? 0) * 1.1 || 1 : 100;
  const at = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  return (
    <span className="rkb-meter" aria-hidden="true">
      <i style={{ "--w": at(value) } as CSSProperties} />
      {mark !== null && mark < top && (
        <span className="rkb-tick" style={{ left: at(mark) }}>
          <small>{row.key === "big-exchange" ? aud(mark) : `${Math.round(mark)}%`}</small>
        </span>
      )}
    </span>
  );
}

function Exchange({ d }: { d: RiskExchange }) {
  const total = Number(d.totalAud) || 1;
  const parts = [
    ["DCA book coins", d.dcaAud, "var(--alloc-2)"],
    ["USDC and stables", d.stablesAud, "var(--alloc-4)"],
    ["Other coins", d.otherAud, "var(--alloc-5)"],
  ] as const;
  return (
    <>
      <h3>What's on it</h3>
      <div className="rkb-split" aria-hidden="true">
        {parts.map(([name, v, c]) =>
          Number(v) > 0 ? (
            <span key={name} style={{ width: `${(Number(v) / total) * 100}%`, background: c }} />
          ) : null,
        )}
      </div>
      <p className="rkb-legend">
        {parts.map(([name, v, c]) => (
          <span key={name}>
            <i style={{ background: c }} />
            {name} {aud(v)}
          </span>
        ))}
      </p>
      {d.moves.length > 0 && (
        <div className="rkb-move">
          <p>
            <b>This month's move to the Ledger: {aud(d.moveAud)}</b>{" "}
            <span className="muted">
              brings Binance to {aud(d.afterAud)} and the 2026 coins to 70% on the Ledger.
            </span>
          </p>
          <div className="dcb-scroll">
            <table className="dcb-table" aria-label="Move to the Ledger">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th className="r">Move</th>
                  <th className="r">About</th>
                  <th className="r">Leaves on Binance</th>
                </tr>
              </thead>
              <tbody>
                {d.moves.map((m) => (
                  <tr key={m.coin}>
                    <td>
                      <span className="dcb-coin">
                        <CoinIcon coin={m.coin} />
                        {m.coin}
                      </span>
                    </td>
                    <td className="r num">{aud(m.aud)}</td>
                    <td className="r num muted">{Number(m.qty) ? `${m.qty} ${m.coin}` : "—"}</td>
                    <td className="r num">{aud(m.leaves)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rkb-note">
            Largest first. The desk never withdraws: you send it from Binance to your Ledger.
          </p>
        </div>
      )}
    </>
  );
}

function Cold({ d }: { d: RiskCold }) {
  if (!d.setUp) {
    return (
      <p className="rkb-empty">
        No Ledger addresses yet, so every 2026 coin counts as on the exchange. Watch-only public
        addresses come next: nothing that can sign or send.
      </p>
    );
  }
  return (
    <div className="dcb-scroll">
      <table className="dcb-table" aria-label="2026 coins by place">
        <thead>
          <tr>
            <th>Coin</th>
            <th className="r">Ledger</th>
            <th className="r">Binance</th>
            <th className="r">On Ledger</th>
          </tr>
        </thead>
        <tbody>
          {d.coins.map((c) => (
            <tr key={c.coin}>
              <td>
                <span className="dcb-coin">
                  <CoinIcon coin={c.coin} />
                  {c.coin}
                </span>
              </td>
              <td className="r num">{aud(c.ledgerAud)}</td>
              <td className="r num">{aud(c.binanceAud)}</td>
              <td className="r num">{Math.round(Number(c.pct))}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// TAO's share as new money lands, prices flat: the line falls toward the target.
function Glide({ d }: { d: RiskTao }) {
  const value = Number(d.valueAud);
  const crypto = Number(d.cryptoAud);
  const weekly = Number(d.weeklyAud);
  const target = Number(d.targetPct);
  const span = Math.max(12, Math.ceil((d.weeks || 12) * 1.4));
  const now = (value / crypto) * 100;
  const low = Math.min(target, now) - 5;
  const high = now + 3;
  const x = (w: number) => 34 + (w / span) * 276;
  const y = (v: number) => 128 - ((v - low) / (high - low)) * 112;
  const path = Array.from({ length: span + 1 }, (_, w) => {
    const share = (value / (crypto + weekly * w)) * 100;
    return `${w ? "L" : "M"}${x(w).toFixed(1)} ${y(share).toFixed(1)}`;
  }).join(" ");
  return (
    <svg
      className="rkb-glide"
      viewBox="0 0 320 150"
      role="img"
      aria-label={`TAO's share falls from ${Math.round(now)}% to ${target}% in about ${d.weeks} weeks of the weekly DCA, at today's prices.`}
    >
      <line className="rkb-target" x1={34} x2={310} y1={y(target)} y2={y(target)} />
      <text x={310} y={y(target) - 6} textAnchor="end">
        target {target}%
      </text>
      <path className="rkb-path" d={path} pathLength={1} />
      <circle className="rkb-now" cx={x(0)} cy={y(now)} r={4} />
      <text x={x(0) + 8} y={y(now) - 6}>
        now {Math.round(now)}%
      </text>
      {d.weeks > 0 && d.weeks <= span && (
        <circle className="rkb-goal" cx={x(d.weeks)} cy={y(target)} r={4} />
      )}
      <text x={34} y={146}>
        now
      </text>
      <text x={310} y={146} textAnchor="end">
        +{span} weeks
      </text>
    </svg>
  );
}

function Tao({ d, onMark, busy }: { d: RiskTao; onMark: (key: string) => void; busy: boolean }) {
  const [trim, setTrim] = useState(20);
  const value = Number(d.valueAud);
  const crypto = Number(d.cryptoAud);
  const other = Number(d.otherAud);
  const weekly = Number(d.weeklyAud);
  const t = Number(d.targetPct) / 100;
  const p = trim / 100;
  const sold = value * p;
  const kept = value - sold;
  const gap = kept / t - kept - (other + sold);
  const weeksAfter = gap > 0 && weekly > 0 ? Math.ceil(gap / weekly) : 0;
  const pnl = d.pnlAud === null ? null : Number(d.pnlAud);
  return (
    <>
      <div className="rkb-figs">
        <div>
          <b className="num">{aud(d.valueAud)}</b>
          <small>value</small>
        </div>
        <div>
          <b className="num">{d.costAud === null ? "—" : aud(d.costAud)}</b>
          <small>cost</small>
        </div>
        <div>
          <b className={`num ${pnl === null ? "" : pnl < 0 ? "down" : "up"}`}>
            {pnl === null ? "—" : `${pnl > 0 ? "+" : ""}${aud(pnl)}`}
          </b>
          <small>
            {pnl === null
              ? "unrealised: enter TAO's cost on Portfolio"
              : `unrealised, ${Math.round((pnl / Number(d.costAud)) * 100)}%`}
          </small>
        </div>
      </div>
      <div className="rkb-pair">
        <div className="rkb-panel">
          <h4>Glide path, new money only</h4>
          {weekly > 0 ? (
            <>
              <Glide d={d} />
              <p className="rkb-note">
                {d.weeks === 0
                  ? "At the target already."
                  : `About ${d.weeks} weeks of the weekly DCA at today's prices${d.reach ? `, around ${day(d.reach, true)}` : ""}${d.onTrack ? "" : `: after ${d.by}`}.`}{" "}
                A falling TAO price gets there sooner; a rising one, later.
              </p>
            </>
          ) : (
            <p className="rkb-note">No weekly plan, so no new money to bring the share down.</p>
          )}
        </div>
        <div className="rkb-panel">
          <h4>What if you trimmed?</h4>
          <label className="rkb-trim">
            <span>
              Sell <b className="num">{trim}%</b> of TAO, into BTC
            </span>
            <input
              type="range"
              min={0}
              max={50}
              step={5}
              value={trim}
              aria-label="Share of TAO to sell"
              onChange={(e) => setTrim(Number(e.target.value))}
            />
          </label>
          <dl className="rkb-out">
            <dt>Sold</dt>
            <dd className="num">{aud(sold)}</dd>
            <dt>{pnl !== null && pnl < 0 ? "Loss realised" : "Gain realised"}</dt>
            <dd className={`num ${pnl !== null && pnl < 0 ? "down" : ""}`}>
              {pnl === null ? "—" : aud(pnl * p)}
            </dd>
            <dt>TAO's share after</dt>
            <dd className="num">{Math.round((kept / crypto) * 100)}%</dd>
            <dt>Glide path saved</dt>
            <dd className="num">
              {trim === 0 ? "none" : `${Math.max(0, d.weeks - weeksAfter)} weeks`}
            </dd>
          </dl>
          <p className="rkb-note">
            A realised loss is carried forward against future capital gains; it doesn't reduce
            income tax. Selling to buy straight back is a wash sale the ATO can disallow. An
            estimate, for your accountant. The desk never proposes this sale: Profile 6.3 sells only
            on a written thesis break.
          </p>
        </div>
      </div>
      <div className={`rkb-thesis${d.thesisDue ? "" : " is-done"}`}>
        <span>
          <b>{d.thesisDue ? "Does TAO's thesis still hold?" : "TAO's thesis holds"}</b>{" "}
          <span className="muted">
            {d.thesisAt
              ? `Last confirmed ${day(d.thesisAt, true)}. Asked each quarter.`
              : "Profile open item 1: write it, then confirm it each quarter."}
          </span>
        </span>
        <span className="rkb-btns">
          <a className="btn btn-small" href="#/profile">
            Write it on the Profile
          </a>
          {d.thesisDue && (
            <button
              type="button"
              className="btn btn-small btn-accent"
              disabled={busy}
              onClick={() => onMark("thesis")}
            >
              It still holds
            </button>
          )}
        </span>
      </div>
    </>
  );
}

function Backup({
  d,
  onMark,
  busy,
}: {
  d: RiskBackup;
  onMark: (key: string) => void;
  busy: boolean;
}) {
  return (
    <>
      <ul className="rkb-checks">
        {d.items.map((i) => (
          <li key={i.key}>
            <span className={`rkb-dot is-${i.state}`} aria-hidden="true">
              {i.state === "ok" ? "✓" : i.state === "due" ? "!" : "✕"}
            </span>
            <span>
              {i.label}
              <small>
                {i.at === null
                  ? "Not done"
                  : i.state === "due"
                    ? `Last ${day(i.at, true)}, due ${i.due ? day(i.due, true) : ""}`
                    : `Confirmed ${day(i.at, true)}`}
              </small>
            </span>
            <button
              type="button"
              className={`btn btn-small${i.state === "ok" ? "" : " btn-accent"}`}
              disabled={busy}
              aria-label={`${i.label}: done today`}
              onClick={() => onMark(i.key)}
            >
              {i.state === "ok" ? "Confirm again" : i.key === "heirs" ? "Mark done" : "Done today"}
            </button>
          </li>
        ))}
      </ul>
      <p className="rkb-never">
        The desk stores only these dates. Never type a seed word, passphrase or the backup's
        location into the desk, a chat or Telegram; nobody from the desk will ever ask.
      </p>
    </>
  );
}

export default function RiskBig({
  rows,
  onMark,
  busy,
}: {
  rows: RiskLimit[];
  onMark: (key: string) => void;
  busy: boolean;
}) {
  const first = rows.find((r) => r.state !== "kept")?.key;
  return (
    <ol className="rkb" aria-label="The four big risks">
      {rows.map((r) => {
        const labels = LABEL[r.key as keyof typeof LABEL];
        return (
          <li key={r.key}>
            <details className={`rkb-card is-${r.state}`} open={r.key === first}>
              <summary>
                <span className="rkb-rank" aria-hidden="true">
                  {r.rank}
                </span>
                <span className="rkb-title">
                  <b>
                    {r.name}{" "}
                    <span className={`rk-state is-${r.state}`}>{labels?.[r.state] ?? r.state}</span>
                  </b>
                  <small>
                    {r.words} Profile {r.rule}.
                  </small>
                </span>
                <span className="rkb-fig">
                  <b className="num">{r.figure}</b>
                  <small>of {r.of}</small>
                </span>
                <Meter row={r} />
              </summary>
              <div className="rkb-body">
                {r.key === "big-exchange" && <Exchange d={r.detail as RiskExchange} />}
                {r.key === "big-cold" && <Cold d={r.detail as RiskCold} />}
                {r.key === "big-tao" && <Tao d={r.detail as RiskTao} onMark={onMark} busy={busy} />}
                {r.key === "big-backup" && (
                  <Backup d={r.detail as RiskBackup} onMark={onMark} busy={busy} />
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
