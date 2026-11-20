// The Trading account's Stats tab: the overall figures, the equity curve in R, and the same
// figures by style and by setup. The api does the sums (pot_stats.py); this only draws them.

import { useState } from "react";
import { day, dollars } from "./dcaFormat";
import { rWord, tone } from "./PotPanel";
import type { PotStatsRow, PotView } from "./types";
import "./pot.css";

type Stats = PotView["stats"];
type Point = NonNullable<Stats["curve"]>[number];

const W = 640;
const H = 220;
const PAD = { l: 44, r: 12, t: 12, b: 24 };

const trades = (n: number) => `${n} closed trade${n === 1 ? "" : "s"}`;

// The equity curve in R, trade by trade from zero, with a hover readout.
function Curve({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const ys = [0, ...points.map((p) => Number(p.cumR))];
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys, y0 + 1);
  // Trade i sits at step i; step 0 is the start, at 0R.
  const x = (i: number) => PAD.l + (i / points.length) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((y1 - v) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const line = ys.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const at = hover === null ? undefined : points[hover];
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const step =
      ((((e.clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * points.length;
    setHover(Math.min(points.length, Math.max(1, Math.round(step))) - 1);
  };
  const summary = `${trades(points.length)} since ${day(first.closed, true)}: ${rWord(
    last.cumR,
  )}, ${dollars(last.cumResult, true)}.`;
  return (
    <figure className="pst-curve">
      <figcaption className="pst-curve-head">
        <span className="label">Equity in R, trade by trade</span>
        <span className="pst-sum num">{summary}</span>
      </figcaption>
      <div className="pst-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Equity curve in R. ${summary}`}
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
        >
          <line className="pst-zero" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
          <text className="pst-axis" x={PAD.l - 6} y={y(0) + 4} textAnchor="end">
            0R
          </text>
          {/* The high and low, unless they'd sit on the 0R label. */}
          {y(0) - y(y1) > 18 && (
            <text className="pst-axis" x={PAD.l - 6} y={y(y1) + 10} textAnchor="end">
              {rWord(String(y1))}
            </text>
          )}
          {y(y0) - y(0) > 18 && (
            <text className="pst-axis" x={PAD.l - 6} y={y(y0)} textAnchor="end">
              {rWord(String(y0))}
            </text>
          )}
          <text className="pst-axis" x={PAD.l} y={H - 6}>
            Start
          </text>
          <text className="pst-axis" x={W - PAD.r} y={H - 6} textAnchor="end">
            {day(last.closed, true)}
          </text>
          <path className="pst-line" d={line} />
          {at && hover !== null && (
            <>
              <line
                className="pst-cross"
                x1={x(hover + 1)}
                x2={x(hover + 1)}
                y1={PAD.t}
                y2={H - PAD.b}
              />
              <circle className="pst-dot" cx={x(hover + 1)} cy={y(Number(at.cumR))} r={4} />
            </>
          )}
        </svg>
        {at && hover !== null && (
          <div
            className="pst-tip"
            style={{
              left: `${(x(hover + 1) / W) * 100}%`,
              top: `${(y(Number(at.cumR)) / H) * 100}%`,
            }}
          >
            <b className="num">
              {rWord(at.cumR)} · {dollars(at.cumResult, true)}
            </b>
            <span>
              Trade {hover + 1} · {rWord(at.r)} · {day(at.closed, true)}
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}

function Table({ title, head, rows }: { title: string; head: string; rows: PotStatsRow[] }) {
  return (
    <section className="pst-group" aria-label={title}>
      <h3>{title}</h3>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{head}</th>
              <th scope="col" className="r">
                Trades
              </th>
              <th scope="col" className="r">
                Won
              </th>
              <th scope="col" className="r">
                Expectancy
              </th>
              <th scope="col" className="r">
                Total
              </th>
              <th scope="col" className="r">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td className="r num">{row.trades}</td>
                <td className="r num">{row.winRate === null ? "—" : `${row.winRate}%`}</td>
                <td className="r num">{rWord(row.expectancyR)}</td>
                <td className={`r num ${tone(Number(row.totalR))}`}>{rWord(row.totalR)}</td>
                <td className={`r num ${tone(Number(row.result))}`}>{dollars(row.result, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PotStats({ stats }: { stats: Stats }) {
  const curve = stats.curve ?? [];
  const byStyle = stats.byStyle ?? [];
  const bySetup = stats.bySetup ?? [];
  const tiles: [string, string][] = [
    ["Trades", String(stats.trades)],
    ["Win rate", stats.winRate === null ? "—" : `${stats.winRate}%`],
    ["Average win", rWord(stats.avgWinR)],
    ["Average loss", rWord(stats.avgLossR)],
    ["Expectancy", rWord(stats.expectancyR)],
    ["Deepest drawdown", `${stats.drawdownPct}%`],
  ];
  return (
    <>
      <dl className="pot-stats">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="num">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        The method is judged after {stats.judgeAfter} trades:{" "}
        {Math.min(stats.trades, stats.judgeAfter)} of {stats.judgeAfter} so far.
      </p>
      {curve.length === 0 ? (
        <p className="pot-empty pst-empty">
          <b>No equity curve yet.</b> {trades(stats.trades)} of the {stats.judgeAfter} needed to
          judge a style; the curve draws from the first trade that closes.
        </p>
      ) : (
        <>
          <Curve points={curve} />
          <div className="pst-groups">
            <Table title="By style" head="Style" rows={byStyle} />
            <Table title="By setup" head="Setup" rows={bySetup} />
          </div>
          <p className="muted pst-note">
            A style needs {stats.judgeAfter} closed trades before its figures say much.
          </p>
        </>
      )}
    </>
  );
}
