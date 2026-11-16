// The Profile's four widgets (decision 62): the summary card, Road to US$1M, Stack to 1 BTC and
// Cash floor. The api works out every figure from profile.md and the live portfolio; this file
// only lays them out. Green is done or on track, amber in progress, red broken or risk, and each
// status also has a word and a mark (code-standards 26).
import type { ReactNode } from "react";
import type { BoardCash, BoardRoad, BoardStack, BoardSummary, Num, ProfileBoard } from "./types";

type Tone = "ok" | "warn" | "bad" | "dim";
const MARK: Record<Tone, string> = { ok: "✓", warn: "▲", bad: "✕", dim: "–" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const n = (v: Num | number | undefined) => (v === null || v === undefined ? null : Number(v));

// Whole numbers with K or M: A$12K, US$1M, A$2.5K.
export function km(value: Num | number | undefined, currency: "A$" | "US$" = "A$"): string {
  const v = n(value);
  if (v === null || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const trim = (x: number, places: number) => String(Number(x.toFixed(places)));
  if (a >= 1_000_000) return `${sign}${currency}${trim(a / 1_000_000, 2)}M`;
  if (a >= 1_000) return `${sign}${currency}${trim(a / 1_000, a >= 100_000 ? 0 : 1)}K`;
  return `${sign}${currency}${Math.round(a)}`;
}
const whole = (v: Num | undefined, currency: "A$" | "US$") =>
  n(v) === null ? "—" : `${currency}${Math.round(Number(v)).toLocaleString("en-AU")}`;
const pct = (v: Num | undefined) => (n(v) === null ? "—" : `${Number(Number(v).toFixed(1))}%`);
const btc = (v: Num | undefined) => (n(v) === null ? "—" : String(Number(Number(v).toFixed(4))));
const month = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? ""} ${y}`;
};
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`pf-tag ${tone}`}>
      <span aria-hidden="true">{MARK[tone]}</span> {children}
    </span>
  );
}

export function Meter({
  value,
  label,
  tone = "ok",
  thin = false,
}: {
  value: Num | undefined;
  label: string;
  tone?: Tone;
  thin?: boolean;
}) {
  const shown = Math.max(0, Math.min(100, n(value) ?? 0));
  return (
    <div
      className={`pf-meter ${tone}${thin ? " thin" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(shown)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${shown}%` }} />
    </div>
  );
}

interface Tick {
  at: number; // 0 to 100 along the track
  label: string;
  sub?: string | null;
  state: "passed" | "next" | "";
  flag?: boolean;
}

// A track from 0 to the goal: filled parts, ticks with labels under them, and a You marker.
function Track({
  label,
  parts,
  ticks,
  you,
}: {
  label: string;
  parts: { at: number; tone: Tone }[];
  ticks: Tick[];
  you?: number | null;
}) {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const filled = clamp(parts.reduce((s, p) => s + p.at, 0));
  return (
    <div className="pf-track-wrap">
      {you !== null && you !== undefined && (
        <div className="pf-you" style={{ left: `${clamp(you)}%` }} aria-hidden="true">
          You
        </div>
      )}
      <div
        className="pf-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(filled)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {parts.map((p, i) => (
          <i key={i} className={p.tone} style={{ width: `${clamp(p.at)}%` }} />
        ))}
        {ticks.map((t) => (
          <b
            key={t.label}
            className={`pf-tick ${t.state}${t.flag ? " flag" : ""}`}
            style={{ left: `${clamp(t.at)}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="pf-tick-labels" aria-hidden="true">
        {ticks.map((t) => (
          <span
            key={t.label}
            className={`${t.state}${t.at > 85 ? " end" : ""}`}
            style={{ left: `${clamp(t.at)}%` }}
          >
            {t.flag && <span className="pf-flag">⚑</span>}
            {t.label}
            {t.sub && <small>{t.sub}</small>}
          </span>
        ))}
      </div>
    </div>
  );
}

function Leg({
  title,
  value,
  text,
  tone = "warn",
}: {
  title: string;
  value: Num | undefined;
  text: string;
  tone?: Tone;
}) {
  return (
    <div className="pf-leg">
      <div className="pf-leg-head">
        <span className="muted">{title}</span>
        <span>{text}</span>
      </div>
      <Meter value={value} label={title} tone={tone} />
    </div>
  );
}

function Card({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card pf-widget" aria-label={title}>
      <div className="pf-head">
        <h2>{title}</h2>
        <span className="pf-spacer" />
        {badge}
      </div>
      {children}
    </section>
  );
}

// 1. Who, the plan in four tiles, the rules never to break, and what's open.
export function Summary({ s, road }: { s: BoardSummary; road: BoardRoad | null }) {
  const dca = s.dca;
  const [first, ...rest] = s.split;
  const day = dca.day ? dca.day.slice(0, 3) : "";
  return (
    <section className="card pf-widget pf-summary" aria-label="Summary">
      <div className="pf-who">
        <span className="ag-ava ag-ava-lg" aria-hidden="true">
          {(s.name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="pf-who-text">
          <strong>
            {s.name ?? "Name not set"}
            {s.age !== null && ` · ${s.age}`}
          </strong>
          {s.subline && <span className="muted">{s.subline}</span>}
        </div>
        <span className="pf-spacer" />
        {s.risk && <Badge tone="bad">{s.risk}</Badge>}
      </div>
      <div className="pf-tiles">
        <div className="pf-tile">
          <span className="muted">Goal</span>
          <span className="pf-big">{road ? km(road.goalUsd, "US$") : "Not set"}</span>
          <span className="muted">
            {road ? `by ${month(road.goalDate)}` : ""}
            {s.goalPct !== null && ` · ${pct(s.goalPct)} done`}
          </span>
        </div>
        <div className="pf-tile">
          <span className="muted">Weekly DCA</span>
          <span className="pf-big">
            {km(dca.weeklyAud)} {day}
          </span>
          <span className="muted">
            {dca.extraAud && dca.fearGreedBelow !== null
              ? `+${km(dca.extraAud)} if Fear & Greed < ${dca.fearGreedBelow}`
              : ""}
            {dca.maxMonthAud && ` · max ${km(dca.maxMonthAud)}/mo`}
          </span>
        </div>
        <div className="pf-tile">
          <span className="muted">{s.splitLabel ?? "Split"}</span>
          <span className="pf-big">{first ?? "Not set"}</span>
          <span className="muted">{rest.join(" · ")}</span>
        </div>
        <div className="pf-tile">
          <span className="muted">Cash floor</span>
          <span className={`pf-big${s.cash.below ? " warn" : ""}`}>
            {km(s.cash.totalAud)} / {km(s.cash.floorAud, "A$").replace("A$", "")}
          </span>
          {s.cash.below ? (
            <Badge tone="warn">Below the floor</Badge>
          ) : (
            <Badge tone="ok">Full</Badge>
          )}
        </div>
      </div>
      {s.chips.length > 0 && (
        <div className="pf-chips" aria-label="Never break">
          <span className="muted">Never break</span>
          {s.chips.map((c) => (
            <span key={c} className="pf-chip">
              {c}
            </span>
          ))}
        </div>
      )}
      <div className="pf-foot">
        {s.openItems.length > 0 ? (
          <span title={s.openItems.join("\n")}>
            <Badge tone="warn">{plural(s.openItems.length, "open item")}</Badge>
          </span>
        ) : (
          <Badge tone="ok">No open items</Badge>
        )}
        {s.lesson && (
          <span className="pf-lesson" title={s.lesson.story}>
            <span className="muted">Biggest lesson · </span>
            {s.lesson.lesson}
          </span>
        )}
      </div>
    </section>
  );
}

// 2. Road to US$1M: the goal total against the milestones.
export function Road({ r }: { r: BoardRoad }) {
  const goal = Number(r.goalUsd);
  const at = (usd: string | number) => (Number(usd) / goal) * 100;
  const title = `Road to ${km(r.goalUsd, "US$")}`;
  const ticks: Tick[] = r.ticks.map((t, i) => ({
    at: at(t.usd ?? 0),
    label: km(t.usd, "US$").replace("US$", ""),
    sub: String(t.year),
    state: t.state,
    flag: i === r.ticks.length - 1,
  }));
  const leg = r.leg;
  return (
    <Card
      title={title}
      badge={
        r.known ? (
          r.onTrack ? (
            <Badge tone="ok">On track</Badge>
          ) : (
            <Badge tone="warn">Behind</Badge>
          )
        ) : null
      }
    >
      {r.known ? (
        <>
          <p className="pf-figure">
            <span className="pf-huge">{whole(r.totalUsd, "US$")}</span>
            <span className="muted">
              {" "}
              · {pct(r.pct)} of {km(r.goalUsd, "US$")}
            </span>
          </p>
          {r.parts && (
            <p className="muted pf-sub">
              {km(r.totalAud)} = TAO {km(r.parts.taoAud)} + Binance {km(r.parts.binanceAud)} +
              emergency {km(r.parts.emergencyAud)}
            </p>
          )}
          <Track
            label={`Goal total against ${km(r.goalUsd, "US$")}`}
            parts={[{ at: at(r.totalUsd ?? 0), tone: r.onTrack ? "ok" : "warn" }]}
            ticks={ticks}
            you={at(r.totalUsd ?? 0)}
          />
          {leg && (
            <Leg
              title={`This leg · ${km(leg.fromUsd, "US$")} → ${km(leg.toUsd, "US$")}`}
              value={leg.pct}
              text={`${pct(leg.pct)} · ${km(leg.toGoUsd, "US$")} to go · ${plural(leg.monthsLeft, "month")} left`}
            />
          )}
          {r.then && (
            <div className="pf-then">
              <span className="muted">
                Then {km(r.then.usd, "US$")} by {r.then.year}
              </span>
              <Meter value={r.thenPct} label={`Toward ${km(r.then.usd, "US$")}`} thin />
              <span className="muted">{pct(r.thenPct)}</span>
            </div>
          )}
        </>
      ) : (
        <LiveOff />
      )}
    </Card>
  );
}

// 3. Stack to 1 BTC: BTC held, the next step and the weekly buy.
export function Stack({ b }: { b: BoardStack }) {
  const target = Number(b.target);
  const at = (v: string | number) => (Number(v) / target) * 100;
  const next = b.next ? Number(b.next) : null;
  const ticks: Tick[] = b.ticks.map((t, i) => {
    const last = i === b.ticks.length - 1;
    return {
      at: at(t),
      label: btc(t),
      sub: last && b.projected ? month(b.projected) : null,
      state: Number(t) <= Number(b.held ?? 0) ? "passed" : Number(t) === next ? "next" : "",
      flag: last,
    };
  });
  const badge =
    b.bought === null ? (
      <Badge tone="dim">Couldn&apos;t check this week</Badge>
    ) : b.bought ? (
      <Badge tone="ok">Bought this week</Badge>
    ) : (
      <Badge tone="warn">Not bought yet</Badge>
    );
  const leg = b.leg;
  return (
    <Card title={`Stack to ${btc(b.target)} BTC`} badge={b.known ? badge : null}>
      {b.known ? (
        <>
          <p className="pf-figure">
            <span className="pf-huge">{btc(b.held)} BTC</span>
            <span className="muted">
              {" "}
              · {pct(b.pct)} of {btc(b.target)} BTC
            </span>
          </p>
          <p className="muted pf-sub">
            {km(b.valueAud)}
            {b.weeklyAud && ` · ${km(b.weeklyAud)} every ${b.day ?? "week"}`}
          </p>
          <Track
            label={`BTC held against ${btc(b.target)} BTC`}
            parts={[{ at: at(b.held ?? 0), tone: "ok" }]}
            ticks={ticks}
            you={at(b.held ?? 0)}
          />
          {leg && (
            <Leg
              title={`This leg · ${btc(leg.from)} → ${btc(leg.to)} BTC`}
              value={leg.pct}
              text={`${pct(leg.pct)} · ${btc(leg.toGo)} BTC to go${
                leg.weeksLeft !== null ? ` · ${plural(leg.weeksLeft, "weekly buy")}` : ""
              }`}
            />
          )}
          {b.projected && (
            <p className="pf-note muted">
              {btc(b.target)} BTC by {month(b.projected)} at today&apos;s price
            </p>
          )}
        </>
      ) : (
        <LiveOff />
      )}
    </Card>
  );
}

// 4. Cash floor: parked tax and the emergency fund against the minimum.
export function Cash({ c }: { c: BoardCash }) {
  const floor = Number(c.floorAud);
  const ticks: Tick[] = c.ticks.map((t, i) => {
    const last = i === c.ticks.length - 1;
    return {
      at: (Number(t.aud) / floor) * 100,
      label: km(t.aud).replace("A$", ""),
      sub: last && c.projected ? month(c.projected) : null,
      state: t.state,
      flag: last,
    };
  });
  const e = c.emergency;
  return (
    <Card
      title="Cash floor"
      badge={
        c.full ? <Badge tone="ok">Full</Badge> : <Badge tone="warn">{km(c.shortAud)} short</Badge>
      }
    >
      <p className="pf-figure">
        <span className="pf-huge">{km(c.totalAud)}</span>
        <span className="muted">
          {" "}
          · {pct(c.pct)} of {km(c.floorAud)}
        </span>
      </p>
      <p className="muted pf-sub">
        Parked tax {km(c.parkedAud)} + emergency {km(c.emergencyAud)}
        {c.monthlyAud && ` · ${km(c.monthlyAud)} a month in`}
      </p>
      <Track
        label={`Cash against the ${km(c.floorAud)} floor`}
        parts={[
          { at: n(c.parkedPct) ?? 0, tone: "ok" },
          { at: n(c.emergencyPct) ?? 0, tone: "warn" },
        ]}
        ticks={ticks}
      />
      <p className="pf-key muted">
        <span className="pf-key-dot ok" aria-hidden="true" /> Parked tax
        <span className="pf-key-dot warn" aria-hidden="true" /> Emergency fund
      </p>
      {e && (
        <Leg
          title={`Emergency fund · ${km(c.emergencyAud)} of ${km(e.targetAud)}`}
          value={e.pct}
          text={
            n(e.toGoAud)
              ? `${km(e.toGoAud)} to go · ${plural(e.months, "month")}${c.monthlyAud ? ` at ${km(c.monthlyAud)}` : ""}`
              : "Full"
          }
          tone={n(e.toGoAud) ? "warn" : "ok"}
        />
      )}
      {c.projected && (
        <p className="pf-note muted">Full by {month(c.projected)} at the monthly amount</p>
      )}
    </Card>
  );
}

function LiveOff() {
  return <p className="muted">Live figures couldn&apos;t be read just now.</p>;
}

export default function Board({ board }: { board: ProfileBoard }) {
  return (
    <div className="pf-board">
      <Summary s={board.summary} road={board.road} />
      {board.road && <Road r={board.road} />}
      {board.stack && <Stack b={board.stack} />}
      {board.cash && <Cash c={board.cash} />}
    </div>
  );
}
