import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, getDeposits, getSentimentDetail, getWatchlist } from "./api";
import CoinIcon from "./CoinIcon";
import { amountSleek, percent, shortDate, trend, usdShort } from "./format";
import type { Money } from "./money";
import type { FyDeposits, Holding, SentimentDetail, Watchlist } from "./types";

// The Dashboard's widgets open a panel with more on what they show (decision 42).

export type DetailKind =
  "total" | "accounts" | "pnl" | "fear" | "allocation" | "deposits" | "movers" | "signals";

const TITLES: Record<DetailKind, string> = {
  total: "Total value",
  accounts: "Accounts",
  pnl: "PnL by coin",
  fear: "Fear & Greed Index",
  allocation: "Allocation",
  deposits: "USDC deposits",
  movers: "Top movers",
  signals: "AI signals",
};

// A widget's card, clickable as a whole; its own buttons keep working above the cover.
export function Clickable({
  kind,
  onOpen,
  children,
}: {
  kind: DetailKind;
  onOpen: (kind: DetailKind, at: DOMRect) => void;
  children: ReactNode;
}) {
  return (
    <div className="widget-wrap">
      {children}
      <button
        type="button"
        className="widget-open"
        aria-label={`Details: ${TITLES[kind]}`}
        onClick={(e) => onOpen(kind, e.currentTarget.getBoundingClientRect())}
      />
    </div>
  );
}

export function DetailPanel({
  kind,
  at,
  onClose,
  holdings,
  m,
  history,
  accounts,
}: {
  kind: DetailKind | null;
  at: DOMRect | null;
  onClose: () => void;
  holdings: Holding[];
  m: Money;
  history: { day: string; value: string }[];
  accounts: { name: string; value: number }[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (kind) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [kind]);
  return (
    <dialog
      ref={dialog}
      className="detail-panel in-place"
      style={placed(at)}
      aria-labelledby="detail-title"
      onClose={onClose}
    >
      {kind && (
        <>
          <div className="detail-head" onPointerDown={dragPanel}>
            <h2 id="detail-title">{TITLES[kind]}</h2>
            <button
              type="button"
              className="link"
              aria-label="Close"
              onClick={() => dialog.current?.close?.()}
            >
              ✕
            </button>
          </div>
          {kind === "fear" && <FearDetail />}
          {kind === "total" && <TotalDetail history={history} m={m} accounts={accounts} />}
          {kind === "accounts" && <AccountsDetail holdings={holdings} m={m} />}
          {kind === "pnl" && <PnlDetail holdings={holdings} m={m} />}
          {kind === "allocation" && <AllocationDetail holdings={holdings} m={m} />}
          {kind === "movers" && <MoversDetail holdings={holdings} />}
          {kind === "deposits" && <DepositsDetail />}
          {kind === "signals" && <SignalsDetail />}
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
  [25, 45, "Fear", "#f0616d"],
  [45, 55, "Neutral", "#e8b04b"],
  [55, 75, "Greed", "#2ebd85"],
  [75, 101, "Extreme Greed", "#1e8a5f"],
];
function zone(value: number): string {
  return ZONES.find(([lo, hi]) => value >= lo && value < hi)?.[3] ?? "#e8b04b";
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
            <span className="label">Total market cap</span>
            <b className={`num ${trend(data.market.capChange)}`}>
              {percent(data.market.capChange)}
            </b>
            <small className="muted">{usdShort(data.market.cap)}</small>
          </div>
          <div>
            <span className="label">24h volume</span>
            <b className="num">{usdShort(data.market.volume)}</b>
            <small className="muted">
              Bitcoin {Number(data.market.btcShare).toFixed(1)}% of the market
            </small>
          </div>
        </div>
      )}
    </>
  );
}

function TotalDetail({
  history,
  m,
  accounts,
}: {
  history: { day: string; value: string }[];
  m: Money;
  accounts: { name: string; value: number }[];
}) {
  const values = history.map((h) => Number(h.value));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const w = 400;
  const h = 110;
  const d =
    values.length > 1
      ? values
          .map(
            (v, i) =>
              `${i ? "L" : "M"} ${((i / (values.length - 1)) * w).toFixed(1)} ${(h - ((v - lo) / (hi - lo || 1)) * h).toFixed(1)}`,
          )
          .join(" ")
      : "";
  const first = values[0];
  const last = values[values.length - 1];
  return (
    <>
      {d ? (
        <>
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="fg-line"
            role="img"
            aria-label="Total value by day"
          >
            <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
          </svg>
          <div className="kv">
            <span className="muted">
              Since {shortDate(history[0]?.day ?? "")} ({history.length} days)
            </span>
            {first !== undefined && last !== undefined && (
              <span className={`num ${trend(String(last - first))}`}>
                {m.whole(last - first, true)}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="muted">
          The value is kept once a day; the line fills in over the coming days.
        </p>
      )}
      <h3 className="detail-h">By account</h3>
      {accounts.map((a) => (
        <div className="kv" key={a.name}>
          <span className="muted">{a.name}</span>
          <span className="num">{m.whole(a.value)}</span>
        </div>
      ))}
    </>
  );
}

function CoinRows({ holdings, value }: { holdings: Holding[]; value: (h: Holding) => ReactNode }) {
  return (
    <div className="detail-rows">
      {holdings.map((h) => (
        <div className="kv" key={`${h.asset}-${h.source}`}>
          <span className="coin">
            <CoinIcon coin={h.asset} />
            {h.asset}
            <small className="muted">{h.source === "Binance" ? "Binance" : "Wallet"}</small>
          </span>
          <span className="num">{value(h)}</span>
        </div>
      ))}
      {holdings.length === 0 && <p className="muted">Nothing to show.</p>}
    </div>
  );
}

function AccountsDetail({ holdings, m }: { holdings: Holding[]; m: Money }) {
  const by = (source: Holding["source"]) =>
    holdings
      .filter((h) => h.source === source && Number(h.value ?? 0) >= 1)
      .sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <>
      <h3 className="detail-h">Binance</h3>
      <CoinRows
        holdings={by("Binance")}
        value={(h) => (
          <>
            {amountSleek(h.amount, h.price)} · {m.whole(h.value)}
          </>
        )}
      />
      <h3 className="detail-h">Wallet</h3>
      <CoinRows
        holdings={by("TAO wallet")}
        value={(h) => (
          <>
            {amountSleek(h.amount, h.price)} · {m.whole(h.value)}
          </>
        )}
      />
    </>
  );
}

function PnlDetail({ holdings, m }: { holdings: Holding[]; m: Money }) {
  const rows = holdings
    .filter((h) => h.profit !== null)
    .sort((a, b) => Number(a.profit) - Number(b.profit));
  return (
    <>
      <p className="detail-summary">Unrealised, worst first, against what each coin cost.</p>
      <CoinRows
        holdings={rows}
        value={(h) => (
          <span className={trend(h.profit)}>
            {m.whole(h.profit, true)} · {percent(h.profitPercent)}
          </span>
        )}
      />
    </>
  );
}

function AllocationDetail({ holdings, m }: { holdings: Holding[]; m: Money }) {
  const valued = holdings.filter((h) => Number(h.value ?? 0) >= 1);
  const whole = valued.reduce((s, h) => s + Number(h.value), 0) || 1;
  const rows = [...valued].sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <CoinRows
      holdings={rows}
      value={(h) => (
        <>
          {((Number(h.value) / whole) * 100).toFixed(1)}% · {m.whole(h.value)}
        </>
      )}
    />
  );
}

function MoversDetail({ holdings }: { holdings: Holding[] }) {
  const seen = new Set<string>();
  const moved = holdings
    .filter((h) => h.change24h !== null && !["USDT", "USDC", "FDUSD"].includes(h.asset))
    .filter((h) => !seen.has(h.asset) && Boolean(seen.add(h.asset)));
  const gained = moved
    .filter((h) => Number(h.change24h) > 0)
    .sort((a, b) => Number(b.change24h) - Number(a.change24h));
  const lost = moved
    .filter((h) => Number(h.change24h) <= 0)
    .sort((a, b) => Number(a.change24h) - Number(b.change24h));
  const biggest = (list: Holding[]) => Math.abs(Number(list[0]?.change24h ?? 0));
  const [picked, setPicked] = useState<"gained" | "lost" | null>(null);
  const way = picked ?? (biggest(gained) >= biggest(lost) ? "gained" : "lost");
  const rows = way === "gained" ? gained : lost;
  return (
    <>
      <div className="seg bot-filter" role="group" aria-label="Show">
        {(["gained", "lost"] as const).map((w) => (
          <button
            key={w}
            type="button"
            className={way === w ? "on" : ""}
            aria-pressed={way === w}
            onClick={() => setPicked(w)}
          >
            {w === "gained" ? `Gained (${gained.length})` : `Lost (${lost.length})`}
          </button>
        ))}
      </div>
      <div className="detail-rows detail-scroll">
        {rows.map((h) => (
          <div className="kv" key={h.asset}>
            <span className="coin">
              <CoinIcon coin={h.asset} />
              {h.asset}
            </span>
            <span className={`num ${trend(h.change24h)}`}>{percent(h.change24h)}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="muted">Nothing {way} in 24 hours.</p>}
      </div>
    </>
  );
}

const DEPOSITS_PAGE = 20;

function DepositsDetail() {
  const { data, error } = useLoad<FyDeposits>(getDeposits);
  const [shown, setShown] = useState(DEPOSITS_PAGE);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <div className="skeleton" style={{ height: 240 }} />;
  const aud = (v: string | null) =>
    v === null ? "–" : `A$${Math.round(Number(v)).toLocaleString("en-AU")}`;
  const newest = [...data.deposits].sort((a, b) => b.time - a.time);
  const estimated = data.total.estimated
    ? `, ${data.total.estimated} estimated at that day's rate`
    : "";
  return (
    <>
      <p className="detail-summary">
        FY {data.fy}: {aud(data.total.aud)} for {Number(data.total.usdc).toLocaleString("en-AU")}{" "}
        USDC over {newest.length} deposits
        {estimated}.
      </p>
      <div className="detail-rows detail-scroll">
        {newest.slice(0, shown).map((d) => (
          <div className="kv" key={d.time}>
            <span className="muted">{shortDate(d.day)}</span>
            <span className="num">
              {Number(d.amount).toLocaleString("en-AU")} USDC · {aud(d.aud)}
              {d.basis === "estimate" && <small className="muted"> est.</small>}
            </span>
          </div>
        ))}
      </div>
      {shown < newest.length && (
        <button
          type="button"
          className="btn btn-small detail-more"
          onClick={() => setShown(shown + DEPOSITS_PAGE)}
        >
          Show {Math.min(DEPOSITS_PAGE, newest.length - shown)} more
        </button>
      )}
    </>
  );
}

const loadWatchlist = () => getWatchlist();

function SignalsDetail() {
  const { data, error } = useLoad<Watchlist>(loadWatchlist);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <div className="skeleton" style={{ height: 240 }} />;
  return (
    <div className="detail-rows">
      {data.coins.map((c) => (
        <a className="kv detail-signal" key={c.coin} href="#/trade">
          <span className="coin">
            <CoinIcon coin={c.coin} />
            {c.coin}
          </span>
          <span>
            {c.signal ? (
              <>
                <b>{c.signal.verdict}</b> <span className="muted">{c.signal.confidence}%</span>
              </>
            ) : (
              <span className="muted">No signal</span>
            )}
          </span>
          {c.signal && <small className="muted detail-why">{c.signal.summary}</small>}
        </a>
      ))}
    </div>
  );
}
