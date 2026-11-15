// The Portfolio page's Tax tab (decision 54) and drift card (decision 55). Estimates for the
// owner's records, not tax advice; drift only prefills orders on the Trade page.
import { useEffect, useState } from "react";
import { getDrift, getTax } from "./api";
import { aud, amount, percent, shortDate } from "./format";
import type { Drift, TaxLot, TaxReport } from "./types";

export function TaxTab() {
  const [report, setReport] = useState<TaxReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getTax().then(setReport, (e: unknown) =>
      setError(e instanceof Error ? e.message : "The tax figures couldn't be read."),
    );
  }, []);
  if (error) return <p className="empty">{error}</p>;
  if (!report) return <p className="empty">Working out your lots…</p>;
  const next = report.next;
  return (
    <div className="tax">
      <div className="tax-tiles">
        <div className="tax-tile">
          <div className="label">Realised gains, FY {report.fy}</div>
          <div className="big num up">{aud(report.realisedGainsAud)}</div>
          <div className="muted">
            from {report.sales} sale{report.sales === 1 ? "" : "s"} · estimate
            {report.unknownSales > 0 && ` · ${report.unknownSales} of unknown cost`}
          </div>
        </div>
        <div className="tax-tile">
          <div className="label">Realised losses, FY {report.fy}</div>
          <div className="big num down">{aud(report.realisedLossesAud)}</div>
        </div>
        <div className="tax-tile">
          <div className="label">Unrealised, lots over 12 months</div>
          <div className="big num">{aud(report.discountedAud)}</div>
        </div>
        <div className="tax-tile">
          <div className="label">Next lot to reach 12 months</div>
          <div className="big">
            {next ? `${next.coin} · ${next.daysToDiscount} days` : "None yet"}
          </div>
          {next?.bought && <div className="muted">bought {shortDate(next.bought)}</div>}
        </div>
      </div>
      {report.lots.length === 0 ? (
        <p className="empty">No lots yet.</p>
      ) : (
        <LotsByCoin lots={report.lots} />
      )}
      {report.underWater.length > 0 && (
        <div className="tax-under">
          <h3>Before 30 June: holdings under water</h3>
          <table>
            <thead>
              <tr>
                <th>Coin</th>
                <th className="r">Loss if sold</th>
                <th className="r">This year&apos;s net gains after</th>
              </tr>
            </thead>
            <tbody>
              {report.underWater.map((u) => (
                <tr key={u.coin}>
                  <td>{u.coin}</td>
                  <td className="r num down">{aud(u.lossAud)}</td>
                  <td className="r num">{aud(u.afterAud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Selling and buying straight back to claim a loss can be a wash sale the ATO disallows.
            This view doesn&apos;t suggest it.
          </p>
        </div>
      )}
      <p className="muted tax-note">
        Lots are used first in, first out, at the day&apos;s US dollar to AUD rate, before fees.
        Holdings from before 1 Jul 2026 are one lot of unknown age. Estimates for your records, not
        tax advice; this follows today&apos;s 12-month rule, not the proposed 2027 change.
      </p>
    </div>
  );
}

const sum = (lots: TaxLot[], key: "costAud" | "nowAud" | "gainAud") =>
  lots.some((l) => l[key] === null) ? null : String(lots.reduce((t, l) => t + Number(l[key]), 0));

function Countdown({ lot }: { lot: TaxLot }) {
  if (lot.daysToDiscount === null) return <span className="tax-pill unknown">Age unknown</span>;
  if (lot.daysToDiscount === 0) return <span className="tax-pill ok">Qualifies</span>;
  return (
    <>
      <span className="tax-bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, ((lot.heldDays ?? 0) / 366) * 100)}%` }} />
      </span>
      <span className="tax-pill">{lot.daysToDiscount} days</span>
    </>
  );
}

// One row per coin, opening to its lots: bots buy in many small orders.
function LotsByCoin({ lots }: { lots: TaxLot[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const coins = [...new Set(lots.map((l) => l.coin))];
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Coin</th>
            <th>Lots</th>
            <th className="r">Amount</th>
            <th className="r">Cost</th>
            <th className="r">Now</th>
            <th className="r">Gain</th>
            <th>Next to reach 12 months</th>
          </tr>
        </thead>
        <tbody>
          {coins.map((coin) => {
            const mine = lots.filter((l) => l.coin === coin);
            const waiting = mine.filter((l) => (l.daysToDiscount ?? 0) > 0);
            const next = waiting.sort(
              (a, b) => (a.daysToDiscount ?? 0) - (b.daysToDiscount ?? 0),
            )[0];
            const gain = sum(mine, "gainAud");
            const shown = open === coin;
            return [
              <tr key={coin} className="tax-coin">
                <td>
                  <button
                    className="link"
                    type="button"
                    aria-expanded={shown}
                    onClick={() => setOpen(shown ? null : coin)}
                  >
                    {shown ? "▾" : "▸"} {coin}
                  </button>
                </td>
                <td className="muted">{mine.length}</td>
                <td className="r num">
                  {amount(String(mine.reduce((t, l) => t + Number(l.qty), 0)))}
                </td>
                <td className="r num">{aud(sum(mine, "costAud"))}</td>
                <td className="r num">{aud(sum(mine, "nowAud"))}</td>
                <td className={`r num ${Number(gain ?? 0) < 0 ? "down" : "up"}`}>
                  {gain === null ? "–" : aud(gain)}
                </td>
                <td>{next ? <Countdown lot={next} /> : <Countdown lot={mine[0] as TaxLot} />}</td>
              </tr>,
              ...(shown
                ? mine.map((lot, i) => (
                    <tr key={`${coin}-${i}`} className="tax-lot">
                      <td />
                      <td className="muted">
                        {lot.bought ? shortDate(lot.bought) : "before 1 Jul 2026"}
                      </td>
                      <td className="r num">{amount(lot.qty)}</td>
                      <td className="r num">{aud(lot.costAud)}</td>
                      <td className="r num">{aud(lot.nowAud)}</td>
                      <td className={`r num ${Number(lot.gainAud ?? 0) < 0 ? "down" : "up"}`}>
                        {lot.gainAud === null ? "–" : aud(lot.gainAud)}
                      </td>
                      <td>
                        <Countdown lot={lot} />
                      </td>
                    </tr>
                  ))
                : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DriftCard() {
  const [drift, setDrift] = useState<Drift | null>(null);
  useEffect(() => {
    getDrift().then(setDrift, () => setDrift(null));
  }, []);
  if (!drift) return null;
  if (!drift.hasTargets) {
    return (
      <div className="card drift-card">
        <h3>Allocation against your targets</h3>
        <p className="muted">
          Set target allocations on your <a href="#/profile">Profile</a> to see drift here.
        </p>
      </div>
    );
  }
  const band = Number(drift.band);
  return (
    <div className="card drift-card">
      <h3>
        Allocation against your targets{" "}
        <span className="muted coach-sub">
          · band ±{drift.band} points ·{" "}
          {drift.outside === 0 ? "all in band" : `${drift.outside} outside`}
        </span>
      </h3>
      {drift.rows.map((r) => {
        const target = Number(r.targetPct);
        const now = Number(r.nowPct);
        return (
          <div className="drift-row" key={r.coin}>
            <strong>{r.coin}</strong>
            <div
              className="drift-track"
              aria-label={`${r.coin}: ${r.nowPct}% against a ${r.targetPct}% target`}
            >
              <div
                className="drift-band"
                style={{ left: `${Math.max(0, target - band)}%`, width: `${band * 2}%` }}
              />
              <div
                className={`drift-dot${r.outside ? " out" : ""}`}
                style={{ left: `${Math.min(100, now)}%` }}
              />
            </div>
            <span className="num">{percent(r.targetPct, false)}</span>
            <span className={`num${r.outside ? " wait" : ""}`}>{percent(r.nowPct, false)}</span>
            {r.outside && r.side ? (
              <a
                className="drift-act"
                href={`#/trade?coin=${r.coin}&side=${r.side}&price=${r.price ?? ""}&qty=${r.qty ?? ""}&why=rebalance`}
                title={
                  r.capped
                    ? `${aud(r.toTargetAud ?? null)} to target; one order of your per-trade size`
                    : undefined
                }
              >
                {r.side === "sell" ? "Trim" : "Add"} {aud(r.orderAud ?? null)}
                {r.capped ? " (of " + aud(r.toTargetAud ?? null) + ")" : ""} →
              </a>
            ) : (
              <span className="muted">In band</span>
            )}
          </div>
        );
      })}
      {drift.outside > 0 && (
        <p className="muted drift-note">
          Each link fills a limit order on the Trade page within your per-trade size. You review and
          confirm it; nothing is sent automatically.
        </p>
      )}
    </div>
  );
}
