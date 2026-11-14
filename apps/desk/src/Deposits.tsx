import { useEffect, useState } from "react";
import { ApiError, getDeposits } from "./api";
import type { FyDeposits } from "./types";

// USDC deposits into Binance for the financial year, a bar a month, in AUD (decision 31): what
// was paid where it's recorded, otherwise the amount at the AUD rate on the day it landed.
const aud = (value: string | number, places = 0) =>
  `A$${Number(value).toLocaleString("en-AU", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
const usdc = (value: string) => Number(value).toLocaleString("en-AU", { maximumFractionDigits: 2 });

type State =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: FyDeposits };

export default function Deposits() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [picked, setPicked] = useState<string | null>(null);

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
    return (
      <div aria-hidden="true" className="skeleton card" style={{ height: 220, marginTop: 10 }} />
    );
  }
  if (state.kind === "error") {
    return (
      <section className="card stat widget deposits" aria-label="USDC deposits">
        <div className="label">USDC deposits</div>
        <p className="muted">{state.message}</p>
      </section>
    );
  }
  const { data } = state;
  const top = Math.max(1, ...data.months.map((m) => Number(m.aud)));
  const latest = [...data.months].reverse().find((m) => m.count > 0)?.month ?? null;
  const month = picked ?? latest;
  const chosen = data.months.find((m) => m.month === month);
  const inMonth = data.deposits.filter((d) => d.day.startsWith(month ?? "-"));
  const estimated = inMonth.filter((d) => d.basis !== "paid").length;

  return (
    <section className="card stat widget deposits" aria-label="USDC deposits">
      <div className="kv" style={{ padding: 0 }}>
        <span className="label">Deposits</span>
        <span className="label muted">FY {data.fy}</span>
      </div>
      <div className="big num">{aud(data.total.aud)}</div>
      <div className="muted num" style={{ marginTop: 4 }}>
        {usdc(data.total.usdc)} USDC
        {data.total.audPerUsdc && <> · A${Number(data.total.audPerUsdc).toFixed(3)} each</>}
      </div>
      <div className="dep-bars" role="group" aria-label="Deposits by month">
        {data.months.map((m) => {
          const value = Number(m.aud);
          return (
            <button
              key={m.month}
              type="button"
              aria-pressed={m.month === month}
              aria-label={`${m.label}: ${aud(m.aud)} from ${m.count} deposit${m.count === 1 ? "" : "s"}`}
              title={`${m.label}: ${aud(m.aud)}`}
              disabled={m.count === 0}
              onClick={() => setPicked(m.month)}
            >
              <span className="dep-bar" style={{ height: `${(value / top) * 100}%` }} />
              <span className="dep-month">{m.label.charAt(0)}</span>
            </button>
          );
        })}
      </div>
      {chosen && chosen.count > 0 && (
        <div className="dep-line num">
          <span>{chosen.label}</span>
          <b>{aud(chosen.aud)}</b>
          <span className="muted">
            {chosen.count} deposit{chosen.count === 1 ? "" : "s"}
            {estimated > 0 ? ` · ${estimated} estimated` : ""}
          </span>
        </div>
      )}
    </section>
  );
}
