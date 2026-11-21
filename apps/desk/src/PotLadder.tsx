// A ladder trade (owner, 21 Nov 2026; docs/mockups/trade-ladder.html): a position bought in
// rungs, like the DCA book's ladders. The desk suggests rungs from support (swing lows, the
// year's levels, the averages), each with its odds of filling in a week; every price and
// spend can be changed. The stop and target are optional. The account's rules warn rather than
// refuse on the owner's own trade; Binance's limits, free USDC and the desk's limits refuse.
import { useEffect, useRef, useState } from "react";
import { placeLadder as potPlace, previewLadder as potPreview } from "./api";
import CoinIcon from "./CoinIcon";
import { dollars } from "./dcaFormat";
import { errorOf } from "./format";
import type { LadderPreview, LadderRequest, PotView } from "./types";

type Row = { price: string; spend: string; why: string };

const n2 = (v: string | number) =>
  Number(v).toLocaleString("en-AU", { maximumFractionDigits: Number(v) >= 100 ? 2 : 4 });

function Strip({ seen, stop }: { seen: LadderPreview; stop: string }) {
  const now = Number(seen.now);
  const prices = seen.rungs.map((r) => Number(r.price));
  const s = Number(stop);
  const lo = Math.min(...prices, s > 0 ? s : Infinity, now);
  const hi = now;
  const pad = (hi - lo) * 0.06 || hi * 0.02;
  const at = (v: number) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%`;
  return (
    <div className="ldr-strip num" aria-hidden="true">
      <span className="ldr-line" />
      <span className="ldr-mark is-now" style={{ left: at(now) }}>
        Now {n2(now)}
      </span>
      {prices.map((p) => (
        <span key={p} className="ldr-mark is-rung" style={{ left: at(p) }}>
          {n2(p)}
        </span>
      ))}
      {s > 0 && (
        <span className="ldr-mark is-stop" style={{ left: at(s) }}>
          Stop {n2(s)}
        </span>
      )}
    </div>
  );
}

type Held = { ref: string; key: string; coin: string; spend: string };
// Add funds to a position (owner, 21 Nov 2026): the desk plans limits for the money added, and
// with "replace" its waiting limits are cancelled and planned again with it.
export type AddTo = { ref: string; label: string; waiting: { price: string; spend: string }[] };

export default function PotLadder({
  coins,
  positions = [],
  initialCoin,
  addTo,
  preview,
  place,
  exits = true,
  onClose,
  onPlaced,
}: {
  coins: string[];
  positions?: Held[];
  initialCoin?: string;
  addTo?: AddTo;
  // The DCA book's own preview and place (DcaBookPage); the Trading account's by default.
  preview?: (body: LadderRequest) => Promise<LadderPreview>;
  place?: (body: LadderRequest & { anyway: boolean; override: boolean }) => Promise<unknown>;
  exits?: boolean; // a stop and target to set: the Trading account only
  onClose: () => void;
  onPlaced: (view: PotView | undefined) => void;
}) {
  const previewLadder = preview ?? potPreview;
  const placeLadder = place ?? potPlace;
  const dialog = useRef<HTMLDialogElement>(null);
  const [coin, setCoin] = useState(initialCoin ?? coins[0] ?? "BTC");
  const [total, setTotal] = useState(addTo ? "20" : "50");
  const [replace, setReplace] = useState(false);
  // "": the desk's pick for this coin (A when it swings 6% or more a day, else B).
  const [plan, setPlan] = useState<"" | "A" | "B">("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [useStop, setUseStop] = useState(false);
  const [stop, setStop] = useState("");
  const [useTarget, setUseTarget] = useState(false);
  const [target, setTarget] = useState("");
  const [seen, setSeen] = useState<LadderPreview | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useRef(0);
  // The coin's open positions: a ladder adds to one (the first, by default) or starts its own.
  const mine = [
    ...new Map(positions.filter((p) => p.coin === coin).map((p) => [p.key, p])).values(),
  ];
  const [joinTo, setJoinTo] = useState<string>("");
  const join = addTo ? addTo.ref : joinTo === "new" ? "" : joinTo || mine[0]?.ref || "";
  const again = addTo && replace ? { position: addTo.ref, replace: true } : {};

  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  // New coin, total or rung count: fresh suggestions from the desk.
  useEffect(() => {
    const mine = ++ask.current;
    const t = window.setTimeout(() => {
      previewLadder({ coin, total, ...(plan ? { plan } : {}), ...again }).then(
        (p) => {
          if (mine !== ask.current) return;
          setSeen(p);
          setRows(p.rungs.map((r) => ({ price: r.price, spend: r.spend, why: r.why })));
          setError(null);
        },
        (e: unknown) =>
          mine === ask.current && setError(errorOf(e, "No limits could be suggested.")),
      );
    }, 350);
    return () => window.clearTimeout(t);
    // again follows replace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, total, plan, replace]);

  // An edit to a rung, the stop or the target: the same rungs read again for odds and rules.
  const body = () => ({
    coin,
    rungs: rows ?? [],
    stop: useStop && stop ? stop : undefined,
    target: useTarget && target ? target : undefined,
    position: join || undefined,
    ...again,
  });
  useEffect(() => {
    if (!rows) return;
    const mine = ++ask.current;
    const t = window.setTimeout(() => {
      previewLadder(body()).then(
        (p) => {
          if (mine !== ask.current) return;
          setSeen(p);
          setError(null);
        },
        (e: unknown) =>
          mine === ask.current && setError(errorOf(e, "The ladder couldn't be read.")),
      );
    }, 400);
    return () => window.clearTimeout(t);
    // body() reads these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, useStop, stop, useTarget, target]);

  const edit = (i: number, key: "price" | "spend", value: string) =>
    setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const drop = (i: number) => setRows((rs) => rs && rs.filter((_, j) => j !== i));
  const add = () =>
    setRows((rs) => {
      if (!rs || rs.length >= 6) return rs;
      const last = rs.at(-1);
      const price = last ? String(Math.round(Number(last.price) * 0.95 * 100) / 100) : "";
      return [...rs, { price, spend: last?.spend ?? "20", why: "By hand" }];
    });

  const problems = seen?.problems ?? [];
  const warnings = seen?.warnings ?? [];
  const ready = !!rows && rows.length > 0 && problems.length === 0 && !busy;
  const go = () => {
    setBusy(true);
    setError(null);
    placeLadder({ ...body(), anyway, override: anyway }).then(
      (view) => {
        setBusy(false);
        onPlaced(view as PotView | undefined);
        dialog.current?.close();
      },
      (e: unknown) => {
        setBusy(false);
        setError(errorOf(e, "The ladder wasn't placed."));
      },
    );
  };

  return (
    <dialog ref={dialog} className="dcb-drawer ldr" aria-labelledby="ldr-title" onClose={onClose}>
      <header className="dcb-drawer-head">
        <h2 id="ldr-title">{addTo ? `Add funds · ${coin}` : "Ladder trade"}</h2>
        <small className="dcb-id">
          {addTo
            ? `${addTo.label}: the desk plans limits for what you add, from ${coin}'s support.`
            : "A small entry that fills within the hour, then limits under it: one position."}
        </small>
        <button
          type="button"
          className="link dcb-drawer-close"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </header>

      <div className="ldr-top">
        <label>
          <small>Coin</small>
          <select
            value={coin}
            disabled={!!addTo}
            onChange={(e) => {
              setRows(null);
              setJoinTo("");
              setCoin(e.target.value);
            }}
          >
            {coins.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          <small>{addTo ? "Add (USDC)" : "Total to spend (USDC)"}</small>
          <input
            className="num"
            inputMode="decimal"
            value={total}
            onChange={(e) => {
              setRows(null);
              setTotal(e.target.value.replace(/[^\d.]/g, ""));
            }}
          />
        </label>
        <label>
          <small>Shape</small>
          <select
            value={plan}
            onChange={(e) => {
              setRows(null);
              setPlan(e.target.value as "" | "A" | "B");
            }}
          >
            <option value="">Desk's pick for {coin}</option>
            <option value="A">A · $10 entry + 3 limits (10, 13, 17)</option>
            <option value="B">B · $10 entry + 2 limits (16, 24)</option>
          </select>
        </label>
      </div>

      {addTo && addTo.waiting.length > 0 && (
        <label className="ldr-switch ldr-replace">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => {
              setRows(null);
              setReplace(e.target.checked);
            }}
          />
          Also re-plan its {addTo.waiting.length} waiting{" "}
          {addTo.waiting.length === 1 ? "limit" : "limits"} (
          {dollars(String(addTo.waiting.reduce((s, w) => s + Number(w.spend), 0)))}) with it
        </label>
      )}
      {seen?.replacing && seen.replacing.length > 0 && (
        <p className="ldr-why num">
          <b>Replaces</b>{" "}
          {seen.replacing.map((r) => `${n2(r.price)} (${dollars(r.spend)})`).join(", ")}: they're
          cancelled first, and their {dollars(seen.freed ?? "0")} goes into these limits.
        </p>
      )}
      {!addTo && mine.length > 0 && (
        <label className="ldr-join">
          <small>Adds to</small>
          <select value={join ? join : "new"} onChange={(e) => setJoinTo(e.target.value)}>
            {mine.map((p, i) => (
              <option key={p.key} value={p.ref}>
                Your {coin} position{mine.length > 1 ? ` ${i + 1}` : ""}
              </option>
            ))}
            <option value="new">A new {coin} position</option>
          </select>
        </label>
      )}
      {seen?.planWhy && (
        <p className="ldr-why">
          <b>{plan ? `Shape ${plan}` : `Desk's pick: ${seen.plan}`}.</b> {seen.planWhy}
        </p>
      )}
      {seen && <Strip seen={seen} stop={useStop ? stop : ""} />}

      {!rows ? (
        <p className="muted">Reading {coin}'s support…</p>
      ) : (
        <table className="dcb-table ldr-table num">
          <thead>
            <tr>
              <th>
                <span className="dcb-coin">
                  <CoinIcon coin={coin} />
                  {coin}
                </span>
              </th>
              <th>Price</th>
              <th className="r">Under now</th>
              <th>Spend</th>
              <th>Fill odds, 7 days</th>
              <th>Why here</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const s = seen?.rungs[i];
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <input
                      aria-label={`Limit ${i + 1} price`}
                      inputMode="decimal"
                      value={r.price}
                      onChange={(e) => edit(i, "price", e.target.value)}
                    />
                  </td>
                  <td className="r">{s ? `−${s.underPct}%` : ""}</td>
                  <td>
                    <input
                      aria-label={`Limit ${i + 1} spend`}
                      inputMode="decimal"
                      value={r.spend}
                      onChange={(e) => edit(i, "spend", e.target.value)}
                    />
                  </td>
                  <td>
                    {s && (
                      <span className="ldr-odds">
                        <span className="ldr-odds-bar" aria-hidden="true">
                          <i style={{ width: `${s.odds}%` }} />
                        </span>
                        {s.odds}%
                      </span>
                    )}
                  </td>
                  <td className="muted">{r.why}</td>
                  <td>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="link"
                        aria-label={`Remove limit ${i + 1}`}
                        onClick={() => drop(i)}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows && rows.length < 6 && (
        <button type="button" className="link ldr-add" onClick={add}>
          + Add a limit
        </button>
      )}

      {seen && (
        <p className="ldr-sum num">
          If every limit fills: <b>{dollars(seen.total)}</b>
          {seen.avg && (
            <>
              {" "}
              at an average of <b>{n2(seen.avg)}</b>, {seen.avgPct}% under now
            </>
          )}
          <span className="muted"> · likely in 7 days about {dollars(seen.likely)}</span>
        </p>
      )}

      {exits && (
        <div className="ldr-exits">
          <div className="ldr-opt">
            <label className="ldr-switch">
              <input
                type="checkbox"
                checked={useStop}
                onChange={(e) => setUseStop(e.target.checked)}
              />
              Stop
            </label>
            {useStop ? (
              <>
                <input
                  className="num"
                  inputMode="decimal"
                  placeholder="Under the deepest limit"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                />
                {seen && seen.stop && (
                  <small className="muted num">
                    If every rung fills, you'd lose {dollars(seen.risk)}.
                  </small>
                )}
              </>
            ) : (
              <small className="muted">No stop: nothing sells it until you set one.</small>
            )}
          </div>
          <div className="ldr-opt">
            <label className="ldr-switch">
              <input
                type="checkbox"
                checked={useTarget}
                onChange={(e) => setUseTarget(e.target.checked)}
              />
              Target
            </label>
            {useTarget ? (
              <input
                className="num"
                inputMode="decimal"
                placeholder="Over the highest limit"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            ) : (
              <small className="muted">No target: you decide when to sell.</small>
            )}
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="ldr-problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <div className="ldr-warns" role="status">
          <b>
            {warnings.length} {warnings.length === 1 ? "rule says" : "rules say"} wait
          </b>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="ldr-foot">
        <label className="ldr-anyway">
          <input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} />
          Place anyway: I've read the warnings
        </label>
        <div className="dca-nav">
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={!ready || (warnings.length > 0 && !anyway)}
            onClick={go}
          >
            {busy
              ? "Placing…"
              : seen?.replacing?.length
                ? `Replace with ${rows?.length ?? 0} limits`
                : `Place ${rows?.length ?? 0} limits`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
