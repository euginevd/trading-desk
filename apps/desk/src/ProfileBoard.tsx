// The Profile's plan (decision 62), as a road and a ledger: one chart of the plan over time with
// you on it, then the plan's terms beside the two things being built (the BTC stack and the cash
// floor). The api works out every figure from profile.md and the live portfolio; this file only
// lays them out. Mint is you and done, amber is next or short, red is risk; each also has words.
import { type ReactNode, useState } from "react";
import type { BoardCash, BoardRoad, BoardStack, BoardSummary, Num, ProfileBoard } from "./types";

// A live figure: when the refresh brings a new value, it rolls in from the direction it moved,
// tinted mint (up) or red (down) for a moment. The first value just appears.
function Live({ value, children }: { value: Num | undefined; children: ReactNode }) {
  const now = value === null || value === undefined ? null : Number(value);
  const [seen, setSeen] = useState({ value: now, dir: "", turn: 0 });
  if (seen.value !== now) {
    // Worked out while rendering, so the new value rolls in on the very frame it appears.
    const moved = seen.value !== null && now !== null;
    setSeen({
      value: now,
      dir: moved ? (now > (seen.value ?? 0) ? "up" : "down") : "",
      turn: moved ? seen.turn + 1 : seen.turn,
    });
  }
  return (
    <span key={seen.turn} className={`pf-live${seen.dir ? ` ${seen.dir}` : ""}`}>
      {children}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const n = (v: Num | number | undefined) => (v === null || v === undefined ? null : Number(v));

// Rounded with K or M: US$98K, A$145K, US$1M; one decimal below 10K (A$6.2K), so a small figure
// still moves when it changes.
export function km(value: Num | number | undefined, currency: "A$" | "US$" | "" = "A$"): string {
  const v = n(value);
  if (v === null || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const trim = (x: number, places: number) => String(Number(x.toFixed(places)));
  if (a >= 999_500) return `${sign}${currency}${trim(a / 1_000_000, 2)}M`;
  if (a >= 1_000) return `${sign}${currency}${trim(a / 1_000, a >= 9_950 ? 0 : 1)}K`;
  return `${sign}${currency}${Math.round(a)}`;
}
const pct = (v: Num | undefined) => (n(v) === null ? "—" : `${Number(Number(v).toFixed(1))}%`);
const btc = (v: Num | undefined) => (n(v) === null ? "—" : String(Number(Number(v).toFixed(4))));
const month = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? ""} ${y}`;
};
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const days = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

// Where you stand against the plan's line today, in words.
function standing(r: BoardRoad): string {
  const total = n(r.totalUsd);
  const line = n(r.pathUsd);
  if (total === null || line === null || line === 0) return "";
  if (total >= line) return "on or above the line";
  return (line - total) / line < 0.05 ? "just under the line" : "behind the line";
}

// The road: the plan as a dashed line over time, milestones on it, and you today.
const AVG_MONTH = 30.44;
const monthOf = (day: number) => {
  const d = new Date(day * 86_400_000);
  return `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}`;
};

function RoadChart({ r }: { r: BoardRoad }) {
  const [at, setAt] = useState<number | null>(null); // the day under the pointer or keyboard
  const first = r.path[0];
  const last = r.path[r.path.length - 1];
  if (!first || !last) return null;
  const start = Math.min(days(first.date), days(r.today));
  const span = days(last.date) - start || 1;
  const top = Number(r.goalUsd) || 1;
  const x = (iso: string) => ((days(iso) - start) / span) * 100;
  const y = (usd: Num | number | undefined) => 100 - Math.min(100, ((n(usd) ?? 0) / top) * 100);
  const line = r.path.map((p) => `${x(p.date)},${y(p.usd)}`).join(" ");
  const next = r.leg ? n(r.leg.toUsd) : null;
  const you = r.known ? { left: x(r.today), top: y(r.totalUsd) } : null;
  const end = days(last.date);
  const today = days(r.today);

  // The plan's value on any day: straight between the points, as the api's On track check.
  const planAt = (day: number): number => {
    const pts = r.path.map((p) => ({ d: days(p.date), v: Number(p.usd) }));
    const head = pts[0];
    if (!head || day <= head.d) return head?.v ?? 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a && b && day <= b.d) return a.v + ((b.v - a.v) * (day - a.d)) / (b.d - a.d || 1);
    }
    return pts[pts.length - 1]?.v ?? 0;
  };
  // Near today or a milestone, the pointer snaps to it.
  const snaps = [
    ...(r.known ? [{ day: today, kind: "today" as const, usd: 0 }] : []),
    ...r.path
      .slice(1)
      .map((p) => ({ day: days(p.date), kind: "stop" as const, usd: Number(p.usd) })),
  ];
  const probe = (() => {
    if (at === null) return null;
    const near = snaps.find((s) => Math.abs(s.day - at) <= Math.min(span * 0.012, AVG_MONTH / 2));
    const day = near ? near.day : at;
    const away = Math.round((day - today) / AVG_MONTH);
    const when = away > 0 ? `, in ${plural(away, "month")}` : "";
    const plan = planAt(day);
    const text =
      near?.kind === "today"
        ? `Today: you ${km(r.totalUsd, "US$")}, plan ${km(plan, "US$")}`
        : near?.kind === "stop"
          ? `${monthOf(day)}${when}: milestone ${km(near.usd, "US$")}`
          : `${monthOf(day)}${when}: plan ${km(plan, "US$")}`;
    const left = ((day - start) / span) * 100;
    return { left, top: y(near?.kind === "today" ? r.totalUsd : plan), text };
  })();
  const move = (day: number) => setAt(Math.max(start, Math.min(end, day)));
  const keys = (e: React.KeyboardEvent) => {
    const from = at ?? today;
    const step: Record<string, number> = { ArrowRight: AVG_MONTH, ArrowLeft: -AVG_MONTH };
    if (e.key in step) move(from + (step[e.key] ?? 0));
    else if (e.key === "Home") move(start);
    else if (e.key === "End") move(end);
    else if (e.key === "Escape") setAt(null);
    else return;
    e.preventDefault();
  };
  return (
    <figure className="pf-chart" aria-label="Your plan over time, and where you are today">
      <div
        className="pf-chart-plot"
        tabIndex={0}
        role="slider"
        aria-orientation="horizontal"
        aria-label="Plan over time. Use the arrow keys to move month by month."
        aria-valuemin={0}
        aria-valuemax={Math.round(span / AVG_MONTH)}
        aria-valuenow={Math.round(((at ?? today) - start) / AVG_MONTH)}
        aria-valuetext={probe?.text ?? `Today: you ${km(r.totalUsd, "US$")}`}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          move(start + ((e.clientX - box.left) / (box.width || 1)) * span);
        }}
        onPointerDown={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          move(start + ((e.clientX - box.left) / (box.width || 1)) * span);
        }}
        onPointerLeave={() => setAt(null)}
        onFocus={() => setAt(today)}
        onBlur={() => setAt(null)}
        onKeyDown={keys}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {[25, 50, 75].map((g) => (
            <line key={g} x1="0" x2="100" y1={g} y2={g} className="pf-grid" />
          ))}
          <polyline points={line} className="pf-plan-line" />
        </svg>
        {r.path.slice(1).map((p, i) => {
          const goal = i === r.path.length - 2;
          const isNext = n(p.usd) === next;
          return (
            <span
              key={p.date}
              className={`pf-stop${goal ? " goal" : ""}${isNext ? " next" : ""}`}
              style={{
                left: `${x(p.date)}%`,
                top: `${y(p.usd)}%`,
                animationDelay: `${250 + (i + 1) * (700 / (r.path.length - 1))}ms`,
              }}
            >
              <i aria-hidden="true" />
              <b>
                {goal && (
                  <span className="pf-flag" aria-hidden="true">
                    ⚑{" "}
                  </span>
                )}
                {km(p.usd, "US$")}
              </b>
            </span>
          );
        })}
        {you && (
          <span className="pf-you-dot" style={{ left: `${you.left}%`, top: `${you.top}%` }}>
            <i aria-hidden="true" />
            <b>You</b>
          </span>
        )}
        {probe && (
          <>
            <span className="pf-guide" style={{ left: `${probe.left}%` }} aria-hidden="true" />
            <span
              className="pf-probe"
              style={{ left: `${probe.left}%`, top: `${probe.top}%` }}
              aria-hidden="true"
            />
            <span
              className={`pf-readout${probe.left > 70 ? " end" : probe.left < 15 ? " start" : ""}`}
              style={{ left: `${probe.left}%` }}
            >
              {probe.text}
            </span>
          </>
        )}
      </div>
      <div className="pf-years" aria-hidden="true">
        <span style={{ left: `${x(r.today)}%` }} className="today">
          Today
        </span>
        {r.path.slice(1).map((p) => (
          <span key={p.date} style={{ left: `${x(p.date)}%` }}>
            {month(p.date)}
          </span>
        ))}
      </div>
    </figure>
  );
}

function Road({ r }: { r: BoardRoad }) {
  const where = standing(r);
  const leg = r.leg;
  return (
    <section className="pf-road" aria-label={`Road to ${km(r.goalUsd, "US$")}`}>
      {r.known ? (
        <>
          <h2 className="pf-headline">
            <Live value={r.totalUsd}>{km(r.totalUsd, "US$")}</Live> of {km(r.goalUsd, "US$")}.{" "}
            <Live value={r.pct}>{pct(r.pct)}</Live> of the way{where ? `, ${where}` : ""}.
          </h2>
          {r.parts && (
            <p className="pf-sub">
              <Live value={r.totalAud}>{km(r.totalAud)}</Live>: TAO{" "}
              <Live value={r.parts.taoAud}>{km(r.parts.taoAud)}</Live>, Binance{" "}
              <Live value={r.parts.binanceAud}>{km(r.parts.binanceAud)}</Live>, emergency fund{" "}
              {km(r.parts.emergencyAud)}.
            </p>
          )}
        </>
      ) : (
        <h2 className="pf-headline">
          The road to {km(r.goalUsd, "US$")} by {month(r.goalDate)}. Live figures couldn&apos;t be
          read just now.
        </h2>
      )}
      <RoadChart r={r} />
      <p className="pf-road-note">
        {leg && (
          <>
            Next: <strong>{km(leg.toUsd, "US$")}</strong> by Dec {leg.year},{" "}
            {km(leg.toGoUsd, "US$")} to go in {plural(leg.monthsLeft, "month")}.{" "}
          </>
        )}
        {r.then && (
          <>
            Then {km(r.then.usd, "US$")} by {r.then.year}
            {r.thenPct ? `, ${pct(r.thenPct)} there` : ""}.
          </>
        )}
      </p>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pf-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// The plan's terms: how money goes in, where it goes, and what never happens.
function Terms({ s }: { s: BoardSummary }) {
  const d = s.dca;
  return (
    <section className="pf-col" aria-label="The plan">
      <h2>The plan</h2>
      <dl className="pf-rows">
        <Row label="Weekly DCA">
          <span>
            {km(d.weeklyAud)} every {d.day ?? "week"}
          </span>
          {d.extraAud && d.fearGreedBelow !== null && (
            <span className="muted">
              +{km(d.extraAud)} when Fear &amp; Greed is under {d.fearGreedBelow}
            </span>
          )}
          {d.maxMonthAud && <span className="muted">{km(d.maxMonthAud)} a month at most</span>}
        </Row>
        {s.split.length > 0 && (
          <Row label={s.splitLabel ?? "Split"}>
            {s.split.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </Row>
        )}
        {s.chips.length > 0 && (
          <Row label="Never break">
            <ul className="pf-rules">
              {s.chips.map((c) => (
                <li key={c}>
                  <span className="pf-tick-mark" aria-hidden="true">
                    ✓
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </Row>
        )}
      </dl>
    </section>
  );
}

function Bar({
  parts,
  label,
  marks = [],
}: {
  parts: { at: number; tone: "mint" | "amber" }[];
  label: string;
  marks?: number[];
}) {
  const filled = Math.min(
    100,
    parts.reduce((t, p) => t + p.at, 0),
  );
  return (
    <div
      className="pf-bar"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(filled)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {parts.map((p, i) => (
        <i key={i} className={p.tone} style={{ width: `${Math.max(0, Math.min(100, p.at))}%` }} />
      ))}
      {marks.map((m) => (
        <b key={m} style={{ left: `${m}%` }} aria-hidden="true" />
      ))}
    </div>
  );
}

function Stack({ b }: { b: BoardStack }) {
  const target = Number(b.target) || 1;
  const leg = b.leg;
  return (
    <div className="pf-goal" aria-label={`Stack to ${btc(b.target)} BTC`} role="group">
      <h3>Stack to {btc(b.target)} BTC</h3>
      {b.known ? (
        <>
          <p className="pf-goal-line">
            <strong>
              <Live value={b.held}>{btc(b.held)} BTC</Live>
            </strong>
            <span className="muted">
              {" "}
              of {btc(b.target)}, worth <Live value={b.valueAud}>{km(b.valueAud)}</Live>.{" "}
            </span>
            {b.bought === null ? (
              <span className="muted">This week&apos;s buy couldn&apos;t be checked.</span>
            ) : b.bought ? (
              <span className="pf-done">✓ Bought this week</span>
            ) : (
              <span className="pf-due">Not bought yet this week</span>
            )}
          </p>
          <Bar
            label={`BTC held against ${btc(b.target)} BTC`}
            parts={[{ at: n(b.pct) ?? 0, tone: "mint" }]}
            marks={b.ticks.slice(0, -1).map((t) => (Number(t) / target) * 100)}
          />
          <p className="pf-note">
            {leg && leg.weeksLeft !== null && (
              <>
                Next {btc(leg.to)} BTC in {plural(leg.weeksLeft, "weekly buy")} of {km(b.weeklyAud)}
                .{" "}
              </>
            )}
            {b.projected && (
              <>
                {btc(b.target)} BTC by {month(b.projected)} at today&apos;s price.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="muted">Live figures couldn&apos;t be read just now.</p>
      )}
    </div>
  );
}

function Cash({ c }: { c: BoardCash }) {
  const e = c.emergency;
  return (
    <div className="pf-goal" aria-label="Cash floor" role="group">
      <h3>Cash floor</h3>
      <p className="pf-goal-line">
        <strong>
          <Live value={c.totalAud}>{km(c.totalAud)}</Live>
        </strong>
        <span className="muted"> of {km(c.floorAud)}. </span>
        {c.full ? (
          <span className="pf-done">✓ Full</span>
        ) : (
          <span className="pf-due">{km(c.shortAud)} short</span>
        )}
      </p>
      <Bar
        label={`Cash against the ${km(c.floorAud)} floor`}
        parts={[
          { at: n(c.parkedPct) ?? 0, tone: "mint" },
          { at: n(c.emergencyPct) ?? 0, tone: "amber" },
        ]}
      />
      <p className="pf-note">
        <span className="pf-key mint" aria-hidden="true" />
        Parked tax {km(c.parkedAud)}, <span className="pf-key amber" aria-hidden="true" />
        emergency fund {km(c.emergencyAud)}
        {e?.targetAud ? ` of ${km(e.targetAud)}` : ""}.
        {c.projected && c.monthlyAud && (
          <>
            {" "}
            Full by {month(c.projected)} at {km(c.monthlyAud)} a month.
          </>
        )}
      </p>
    </div>
  );
}

function Building({ b, s }: { b: ProfileBoard; s: BoardSummary }) {
  return (
    <section className="pf-col" aria-label="Building">
      <h2>Building</h2>
      {b.stack && <Stack b={b.stack} />}
      {b.cash && <Cash c={b.cash} />}
      {(s.openItems.length > 0 || s.lesson) && (
        <dl className="pf-rows pf-rows-tight">
          {s.openItems.length > 0 && (
            <Row label={s.openItems.length === 1 ? "Open item" : "Open items"}>
              {s.openItems.map((o) => (
                <span key={o} className="pf-due">
                  {o}
                </span>
              ))}
            </Row>
          )}
          {s.lesson && (
            <Row label="Lesson">
              <span title={s.lesson.story}>
                {s.lesson.lesson.charAt(0).toUpperCase() + s.lesson.lesson.slice(1)}
              </span>
            </Row>
          )}
        </dl>
      )}
    </section>
  );
}

export default function Board({ board }: { board: ProfileBoard }) {
  const s = board.summary;
  return (
    <div className="pf-board">
      {board.road && <Road r={board.road} />}
      <div className="pf-ledger">
        <Terms s={s} />
        <Building b={board} s={s} />
      </div>
      <p className="pf-identity">
        {s.name ?? "You"}
        {s.age !== null && `, ${s.age}`}. {s.risk && <span className="pf-risk">{s.risk} risk</span>}
        {s.subline && `: ${s.subline.toLowerCase().replace(" · ", "; ")}.`}
      </p>
    </div>
  );
}
