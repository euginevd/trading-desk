// The Positions table's cells, shared by the Trade page and the DCA book (owner, 21 Nov 2026:
// "both pages follow a similar style"), so a position reads the same on either: its name and
// age, the planned bar, the holding with its P&L, and the open row's actions.
import type { ReactNode } from "react";
import CoinIcon from "./CoinIcon";
import { dollars, roundPrice, wholeDollars } from "./dcaFormat";
import { Live } from "./Figures";
import type { Money } from "./money";
import { percent } from "./format";

// How long a position has been on: "today", "1 day", "12 days".
export function heldFor(since: number): string {
  const days = Math.floor((Date.now() - since) / 86_400_000);
  return days < 1 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

// The name, then what kind of position it is and for how long: "Ladder · 3 days · 4 orders".
export function PositionName({
  coin,
  n,
  kind,
  since,
  extra,
}: {
  coin: string;
  n?: number | null; // a coin held as more than one position: which one
  kind: string;
  since: number | null;
  extra?: string;
}) {
  return (
    <>
      <span className="dcb-coin">
        <CoinIcon coin={coin} />
        {coin}
        {n ? <span className="muted"> · position {n}</span> : null}
      </span>
      <small className="dcb-id">
        {kind} · {since ? heldFor(since) : "nothing bought yet"}
        {extra && <span className="dcb-count"> · {extra}</span>}
      </small>
    </>
  );
}

// Bought, then waiting in limits, of what's planned: one bar.
export function PlanBar({
  bought,
  waiting,
  planned,
  note,
  done,
  label,
}: {
  bought: number;
  waiting: number;
  planned: number;
  note: string;
  done: boolean;
  label?: string;
}) {
  const of = (x: number) => `${planned > 0 ? Math.min(100, (x / planned) * 100) : 0}%`;
  return (
    <span className="dcb-week num" role={label ? "img" : undefined} aria-label={label}>
      <span className="dcb-week-figs">
        <b>{wholeDollars(String(bought))}</b>
        {waiting > 0 && <span className="wait"> + {wholeDollars(String(waiting))}</span>}
        <span className="muted"> of {wholeDollars(String(planned))}</span>
      </span>
      <span className="dcb-week-bar" aria-hidden="true">
        <i className="is-bought" style={{ width: of(bought) }} />
        <i className="is-limits" style={{ width: of(waiting) }} />
      </span>
      <small className={done ? "is-done" : ""}>{note}</small>
    </span>
  );
}

// What it's worth, its P&L, and the average against the price now.
export function Holding({
  value,
  pnl,
  pnlPct,
  avg,
  now,
  m,
  avgTitle,
}: {
  value: number | null;
  pnl: number;
  pnlPct: number | null;
  avg: number | null;
  now: number | null;
  // The Portfolio passes its currency (A$, US$…); Trade and the DCA book show US$.
  m?: Money;
  avgTitle?: string;
}) {
  const whole = (v: number, signed = false) =>
    m ? m.whole(v, signed) : signed ? dollars(String(v), true) : wholeDollars(String(v));
  const each = (v: number) => (m ? m.price(v) : roundPrice(v));
  if (!avg) {
    return (
      <small className="dcb-cell-note">
        nothing bought yet · now {now === null ? "—" : each(now)}
      </small>
    );
  }
  return (
    <>
      <span className="dcb-hold">
        <b>
          <Live value={value === null ? null : String(value)}>
            {value === null ? "—" : whole(value)}
          </Live>
        </b>
        {/* Its tone follows the figure as shown: one that rounds to 0 reads as neither. */}
        <span className={!/[1-9]/.test(whole(pnl, true)) ? "muted" : pnl > 0 ? "up" : "down"}>
          {whole(pnl, true)}
          {pnlPct !== null && ` (${percent(String(pnlPct))})`}
        </span>
      </span>
      <small className="dcb-cell-note" title={avgTitle}>
        avg {each(avg)} · now {now === null ? "—" : each(now)}
      </small>
    </>
  );
}

// The open row's actions: take profit and add funds first, then the page's own.
export function PositionActions({
  onTakeProfit,
  onAddFunds,
  children,
}: {
  onTakeProfit?: () => void;
  onAddFunds?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="pos-actions">
      {onTakeProfit && (
        <button type="button" className="btn btn-small btn-accent" onClick={onTakeProfit}>
          Take profit
        </button>
      )}
      {onAddFunds && (
        <button type="button" className="btn btn-small" onClick={onAddFunds}>
          Add funds
        </button>
      )}
      {children}
    </div>
  );
}
