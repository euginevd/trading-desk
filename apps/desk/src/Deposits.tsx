import { useEffect, useState } from "react";
import { ApiError, getDeposits } from "./api";
import { km } from "./Figures";
import { shortDate } from "./format";
import type { FyDeposits } from "./types";

// USDC deposits into Binance for the financial year, a bar a month, in AUD (decision 31): what
// was paid where it's recorded, otherwise the amount at the AUD rate on the day it landed. The
// Portfolio's "Money in": pick a month to read it, and open its deposits in place.
const usdc = (value: string) => Number(value).toLocaleString("en-AU", { maximumFractionDigits: 2 });

type State =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: FyDeposits };

export default function Deposits() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getDeposits().then(
      (data) => setState({ kind: "ready", data }),
      (e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof ApiError ? e.message : "Deposits couldn't be read.",
        }),
    );
  }, []);

  if (state.kind === "loading") {
    return <div aria-hidden="true" className="skeleton" style={{ height: 180 }} />;
  }
  if (state.kind === "error") {
    return (
      <section className="port-money" aria-label="USDC deposits">
        <h2>Money in</h2>
        <p className="muted">{state.message}</p>
      </section>
    );
  }
  const { data } = state;
  const top = Math.max(1, ...data.months.map((m) => Number(m.aud)));
  const latest = [...data.months].reverse().find((m) => m.count > 0)?.month ?? null;
  const month = picked ?? latest;
  const chosen = data.months.find((m) => m.month === month);
  const inMonth = data.deposits
    .filter((d) => d.day.startsWith(month ?? "-"))
    .sort((a, b) => b.time - a.time);
  const estimated = inMonth.filter((d) => d.basis !== "paid").length;

  return (
    <section className="port-money" aria-label="USDC deposits">
      <h2>
        Money in <span className="muted">FY {data.fy}</span>
      </h2>
      <p className="port-money-total num">
        <strong title={`A$${Math.round(Number(data.total.aud)).toLocaleString("en-AU")}`}>
          {km(data.total.aud)}
        </strong>{" "}
        <span className="muted">
          for {Math.round(Number(data.total.usdc)).toLocaleString("en-AU")} USDC
          {data.total.audPerUsdc && <>, A${Number(data.total.audPerUsdc).toFixed(3)} each</>}
        </span>
      </p>
      <div className="dep-bars port-dep-bars" role="group" aria-label="Deposits by month">
        {data.months.map((m) => (
          <button
            key={m.month}
            type="button"
            aria-pressed={m.month === month}
            aria-label={`${m.label}: ${km(m.aud)} from ${m.count} deposit${m.count === 1 ? "" : "s"}`}
            title={`${m.label}: ${km(m.aud)}`}
            disabled={m.count === 0}
            onClick={() => {
              setPicked(m.month);
              setOpen(false);
            }}
          >
            {m.month === month && m.count > 0 && (
              <span className="dep-figure num" aria-hidden="true">
                {km(m.aud)}
              </span>
            )}
            <span className="dep-bar" style={{ height: `${(Number(m.aud) / top) * 72}%` }} />
            <span className="dep-month">{m.label.charAt(0)}</span>
          </button>
        ))}
      </div>
      {chosen && chosen.count > 0 && (
        <p className="port-money-month num">
          {chosen.label} <strong>{km(chosen.aud)}</strong>{" "}
          <span className="muted">
            from {chosen.count} deposit{chosen.count === 1 ? "" : "s"}
            {estimated > 0 ? `, ${estimated} estimated` : ""}.
          </span>{" "}
          <button
            type="button"
            className="dash-link"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide them" : "See them"}
          </button>
        </p>
      )}
      {open && (
        <ul className="port-money-list" aria-label={`Deposits in ${chosen?.label ?? ""}`}>
          {inMonth.map((d) => (
            <li key={d.time} className="num">
              <span className="muted">{shortDate(d.day)}</span>
              <span>{usdc(d.amount)} USDC</span>
              <span>
                {d.aud === null ? "–" : km(d.aud)}
                {d.basis !== "paid" && <small className="muted"> est.</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
