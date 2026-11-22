// The Tax page (owner, 22 Nov 2026): this financial year's gains and losses, the lots with their
// 12-month countdown and what's under water before 30 June (moved from the Portfolio's Tax tab),
// and staking income, each claim the owner records valued in AUD when entered. Every source
// counts, Binance and the Ledger alike: moving a coin isn't a sale. Estimates, not tax advice.
import { useEffect, useState } from "react";
import { addStaking, getStaking, getTax, removeStaking } from "./api";
import Fold from "./Fold";
import { aud, amount, errorOf, shortDate } from "./format";
import { TaxTab } from "./Tax";
import type { StakingIncome, TaxReport } from "./types";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Sentence({
  report,
  staking,
}: {
  report: TaxReport | null;
  staking: StakingIncome | null;
}) {
  if (!report) return <h1 className="dcb-headline">Tax</h1>;
  // Losses come from the api as negatives (tax.py), so the year's net adds them.
  const net = Number(report.realisedGainsAud) + Number(report.realisedLossesAud);
  return (
    <h1 className="dcb-headline">
      FY {report.fy}: <span className={net >= 0 ? "up" : "down"}>{aud(String(Math.abs(net)))}</span>{" "}
      net {net >= 0 ? "gain" : "loss"} so far
      {staking && Number(staking.fyAud) > 0 ? `, ${aud(staking.fyAud)} staking income` : ""}.
    </h1>
  );
}

function Staking({
  staking,
  onChange,
}: {
  staking: StakingIncome | null;
  onChange: (next: StakingIncome) => void;
}) {
  const [day, setDay] = useState(todayIso);
  const [coin, setCoin] = useState("TAO");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [rate, setRate] = useState("");
  const act = (action: () => Promise<StakingIncome>, done: string, after?: () => void) => {
    setBusy(true);
    setNote(null);
    action().then(
      (next) => {
        onChange(next);
        setBusy(false);
        setNote({ ok: true, text: done });
        after?.(); // what you typed stays until it's saved
      },
      (e: unknown) => {
        setBusy(false);
        setNote({ ok: false, text: errorOf(e, "Not saved.") });
      },
    );
  };
  if (!staking) return <p className="empty">Reading your staking income…</p>;
  return (
    <div className="tax-staking">
      {staking.claims.length === 0 ? (
        <p className="empty">No claims recorded yet. Add one each time you claim rewards.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Claimed</th>
                <th>Coin</th>
                <th className="r">Amount</th>
                <th className="r">Price</th>
                <th className="r">Income (A$)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staking.claims.map((c) => (
                <tr key={c.id} className={c.thisFy ? "" : "muted"}>
                  <td>{shortDate(c.day)}</td>
                  <td>{c.coin}</td>
                  <td className="r num">{amount(c.amount)}</td>
                  <td className="r num">US${Number(c.priceUsd).toLocaleString("en-AU")}</td>
                  <td className="r num">{aud(c.aud)}</td>
                  <td className="r">
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy}
                      onClick={() => act(() => removeStaking(c.id), "Claim removed")}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="tax-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!qty.trim() || !price.trim() || busy) return;
          act(
            () =>
              addStaking({
                day,
                coin,
                amount: qty.trim(),
                priceUsd: price.trim(),
                ...(rate.trim() ? { audRate: rate.trim() } : {}),
              }),
            "Claim added",
            () => {
              setQty("");
              setPrice("");
              setRate("");
            },
          );
        }}
      >
        <input
          aria-label="Day claimed"
          type="date"
          value={day}
          max={todayIso()}
          onChange={(e) => setDay(e.target.value)}
          disabled={busy}
        />
        <input
          aria-label="Coin"
          value={coin}
          onChange={(e) => setCoin(e.target.value.toUpperCase())}
          disabled={busy}
        />
        <input
          aria-label="Amount claimed"
          inputMode="decimal"
          placeholder="Amount"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          disabled={busy}
        />
        <input
          aria-label="Price in US dollars"
          inputMode="decimal"
          placeholder="Price (US$)"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          disabled={busy}
        />
        <input
          aria-label="A$ per US$ on that day"
          inputMode="decimal"
          placeholder="A$ per US$ (past days)"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn btn-small"
          disabled={busy || !qty.trim() || !price.trim()}
        >
          Add claim
        </button>
      </form>
      {note && (
        <p className={note.ok ? "muted" : "settings-error"} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      )}
      <p className="muted tax-note">
        Rewards are generally income when you receive them, valued in AUD at that time; for TAO
        under Root Reborn that&apos;s each claim. Valued at the desk&apos;s AUD rate on the day you
        add it. Ask your accountant; estimates for your records, not tax advice.
      </p>
    </div>
  );
}

export default function TaxPage() {
  const [report, setReport] = useState<TaxReport | null>(null);
  const [staking, setStaking] = useState<StakingIncome | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [taxFailed, setTaxFailed] = useState<string | null>(null);
  useEffect(() => {
    getTax().then(setReport, (e: unknown) =>
      setTaxFailed(errorOf(e, "The tax figures couldn't be read.")),
    );
    getStaking().then(setStaking, (e: unknown) =>
      setFailed(errorOf(e, "Staking income couldn't be read.")),
    );
  }, []);
  return (
    <main className="wrap dcb tax-page">
      <div className="dcb-top">
        <div>
          <Sentence report={report} staking={staking} />
          <p className="muted dcb-sub">
            Every source counts, Binance and the Ledger: moving a coin to the Ledger isn&apos;t a
            sale, so its lots carry on.
          </p>
        </div>
      </div>
      <Fold id="tax-gains" title="Gains, lots and the 12-month discount">
        {taxFailed ? <p className="empty">{taxFailed}</p> : <TaxTab given={report} />}
      </Fold>
      <Fold
        id="tax-staking"
        title="Staking income"
        summary={
          staking ? `${staking.claims.length} claims · ${aud(staking.fyAud)} this FY` : undefined
        }
      >
        {failed ? (
          <p className="empty">{failed}</p>
        ) : (
          <Staking staking={staking} onChange={setStaking} />
        )}
      </Fold>
    </main>
  );
}
