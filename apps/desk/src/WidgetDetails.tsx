import { useEffect, useRef, useState } from "react";
import { ApiError, getSentimentDetail } from "./api";
import { shortDate, usdShort } from "./format";
import type { SentimentDetail } from "./types";

// The top bar's Fear & Greed opens a panel with more on it (decision 42); the panel helpers here
// are shared with the order panel.

export function FearPanel({ at, onClose }: { at: DOMRect | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (at) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [at]);
  return (
    <dialog
      ref={dialog}
      className="detail-panel in-place"
      style={placed(at)}
      aria-labelledby="fear-title"
      onClose={onClose}
    >
      {at && (
        <>
          <div className="detail-head" onPointerDown={dragPanel}>
            <h2 id="fear-title">Fear &amp; Greed Index</h2>
            <button
              type="button"
              className="link"
              aria-label="Close"
              onClick={() => dialog.current?.close?.()}
            >
              ✕
            </button>
          </div>
          <FearDetail />
        </>
      )}
    </dialog>
  );
}

// A panel moves by its title bar, kept inside the window (decision 46).
export function dragPanel(e: React.PointerEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest("button, a, input, select")) return;
  const panel = e.currentTarget.closest("dialog");
  if (!panel) return;
  const box = panel.getBoundingClientRect();
  const dx = e.clientX - box.left;
  const dy = e.clientY - box.top;
  const move = (ev: PointerEvent) => {
    const left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - box.width);
    const top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 60);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  e.preventDefault();
}

// The panel opens where the card was clicked: over the card, kept inside the window.
const PANEL_WIDTH = 460;
export function placed(at: DOMRect | null): React.CSSProperties | undefined {
  if (!at) return undefined;
  const width = Math.max(at.width, Math.min(PANEL_WIDTH, window.innerWidth - 32));
  const left = Math.min(Math.max(16, at.left), window.innerWidth - width - 16);
  const top = Math.min(Math.max(16, at.top), Math.max(16, window.innerHeight - 320));
  return { left, top, width };
}

function useLoad<T>(get: () => Promise<T>): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    get().then(setData, (e: unknown) =>
      setError(e instanceof ApiError ? e.message : "Couldn't be read."),
    );
  }, [get]);
  return { data, error };
}

// Fear & Greed: today on a gauge, against a day, week, month and year ago, the year's range,
// 90 days on a line, and the market's size and volume.
const ZONES: [number, number, string, string][] = [
  [0, 25, "Extreme Fear", "#c0392b"],
  [25, 45, "Fear", "var(--down)"],
  [45, 55, "Neutral", "var(--wait)"],
  [55, 75, "Greed", "var(--up)"],
  [75, 101, "Extreme Greed", "#1e8a5f"],
];
function zone(value: number): string {
  return ZONES.find(([lo, hi]) => value >= lo && value < hi)?.[3] ?? "var(--wait)";
}

function Gauge({ value, label }: { value: number; label: string }) {
  const r = 80;
  const cx = 100;
  const cy = 95;
  const at = (v: number) => {
    const a = Math.PI * (1 - v / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = at(from + 1);
    const [x2, y2] = at(to - 1);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const [dx, dy] = at(value);
  return (
    <svg viewBox="0 0 200 120" className="fg-dial" role="img" aria-label={`${value}, ${label}`}>
      {ZONES.map(([lo, hi, , colour]) => (
        <path
          key={lo}
          d={arc(lo, Math.min(hi, 100))}
          stroke={colour}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      <circle cx={dx} cy={dy} r="7" fill="var(--text)" stroke="var(--panel)" strokeWidth="3" />
      <text x={cx} y={cy - 18} textAnchor="middle" className="fg-dial-value">
        {value}
      </text>
      <text x={cx} y={cy + 4} textAnchor="middle" className="fg-dial-label">
        {label}
      </text>
    </svg>
  );
}

function Line({ points }: { points: { value: number }[] }) {
  const w = 400;
  const h = 110;
  if (points.length < 2) return null;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - (v / 100) * h;
  const d = points
    .map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="fg-line"
      role="img"
      aria-label="The index over 90 days"
    >
      <line x1="0" x2={w} y1={y(50)} y2={y(50)} className="fg-mid" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
    </svg>
  );
}

const loadSentiment = () => getSentimentDetail();

function FearDetail() {
  const { data, error } = useLoad<SentimentDetail>(loadSentiment);
  const [view, setView] = useState<"overview" | "chart">("overview");
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  const row = (label: string, d: { value: number; label: string } | undefined) =>
    d && (
      <div className="kv" key={label}>
        <span className="muted">{label}</span>
        <span>
          <i className="fg-dot" style={{ background: zone(d.value) }} /> {d.label}{" "}
          <b className="num">{d.value}</b>
        </span>
      </div>
    );
  const day = (ms: number) => shortDate(new Date(ms).toISOString().slice(0, 10));
  return (
    <>
      <p className="detail-summary">{data.summary}</p>
      <div className="seg bot-filter" role="tablist" aria-label="View">
        {(["overview", "chart"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={view === v ? "on" : ""}
            onClick={() => setView(v)}
          >
            {v === "overview" ? "Overview" : "90 days"}
          </button>
        ))}
      </div>
      {view === "overview" ? (
        <Gauge value={data.now.value} label={data.now.label} />
      ) : (
        <Line points={data.chart} />
      )}
      <h3 className="detail-h">Then and now</h3>
      {row("Yesterday", data.history.yesterday)}
      {row("Last week", data.history.lastWeek)}
      {row("Last month", data.history.lastMonth)}
      {row("Last year", data.history.lastYear)}
      <h3 className="detail-h">The year&apos;s high and low</h3>
      {row(`High (${day(data.high.day)})`, data.high)}
      {row(`Low (${day(data.low.day)})`, data.low)}
      {data.market && (
        <div className="dca-tiles detail-tiles">
          <div>
            <span className="label">24h volume</span>
            <b className="num">{usdShort(data.market.volume)}</b>
            <small className="muted">The whole crypto market</small>
          </div>
        </div>
      )}
    </>
  );
}
