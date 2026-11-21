// Take profit on a position (owner, 21 Nov 2026), for the Trade page and the DCA book alike,
// shaped like Add funds (CoinFunds) and open in the position's row:
// sell 25, 50, 75 or 100% of it, at market now or as limit sells the desk suggests just under
// resistance, each at least $10 and leaving $10 or nothing. Every price and share can be
// changed; the desk reads them again for what they'd sell and what the rules say.
import { useEffect, useRef, useState } from "react";
import { dollars, roundPrice } from "./dcaFormat";
import { errorOf } from "./format";
import AgentChat from "./AgentChat";
import type { Ask } from "./CoinFunds";
import type { TakeProfitPreview } from "./types";

export type SellPlan = {
  pct: string;
  market?: boolean;
  levels?: { price: string; pct: string; why?: string }[];
};
export type LiveSell = { ref: string; price: string | null; qty: string; value: number | null };

type Row = { price: string; pct: string; why: string };
const PCTS = ["25", "50", "75", "100"];

export default function TakeProfitPanel({
  coin,
  label,
  live = [],
  preview,
  place,
  cancelLive,
  agent,
  strategize,
  onClose,
  onPlaced,
}: {
  coin: string;
  label: string; // "Your SOL position"
  live?: LiveSell[];
  preview: (plan: SellPlan) => Promise<TakeProfitPreview>;
  place: (plan: SellPlan, anyway: boolean) => Promise<void>;
  cancelLive?: (ref: string) => Promise<void>;
  agent?: string;
  strategize?: Ask;
  onClose: () => void;
  onPlaced: (said: string) => void;
}) {
  const [pct, setPct] = useState("100");
  const [market, setMarket] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [seen, setSeen] = useState<TakeProfitPreview | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = useRef(0);

  // A new share or way to sell: fresh suggestions from the desk.
  useEffect(() => {
    const mine = ++ask.current;
    preview({ pct, market }).then(
      (p) => {
        if (mine !== ask.current) return;
        setSeen(p);
        setRows(p.levels.map((l) => ({ price: l.price ?? "", pct: l.pct, why: l.why })));
        setError(null);
      },
      (e: unknown) => mine === ask.current && setError(errorOf(e, "No sells could be suggested.")),
    );
    // preview is the caller's, bound to this position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, market]);

  // An edit to a level: the same levels read again.
  const plan = (): SellPlan =>
    market || !rows ? { pct, market } : { pct, levels: rows.map((r) => ({ ...r })) };
  const edit = (i: number, key: "price" | "pct", value: string) => {
    const next = rows && rows.map((r, j) => (j === i ? { ...r, [key]: value } : r));
    setRows(next);
    if (!next) return;
    const mine = ++ask.current;
    window.setTimeout(() => {
      if (mine !== ask.current) return;
      preview({ pct, levels: next }).then(
        (p) => mine === ask.current && (setSeen(p), setError(null)),
        (e: unknown) => mine === ask.current && setError(errorOf(e, "Those sells can't be read.")),
      );
    }, 400);
  };
  const drop = (i: number) => {
    if (!rows) return;
    const next = rows.filter((_, j) => j !== i);
    setRows(next);
    preview({ pct, levels: next }).then(setSeen, () => undefined);
  };

  const problems = seen?.problems ?? [];
  const warnings = seen?.warnings ?? [];
  const offered = seen?.pcts ?? PCTS;
  const ready = !!rows && rows.length > 0 && problems.length === 0 && !busy;
  const total = (seen?.levels ?? []).reduce((s, l) => s + Number(l.value), 0);

  const go = () => {
    setBusy("place");
    setError(null);
    place(plan(), anyway).then(
      () => {
        setBusy(null);
        onPlaced(
          market
            ? `Sold ${pct}% of ${coin} at market.`
            : `${rows?.length ?? 0} take-profit ${rows?.length === 1 ? "sell" : "sells"} on Binance for ${coin}.`,
        );
      },
      (e: unknown) => {
        setBusy(null);
        setError(errorOf(e, "Nothing was sold."));
      },
    );
  };
  const stopLive = (ref: string) => {
    if (!cancelLive) return;
    setBusy(ref);
    cancelLive(ref).then(
      () => {
        setBusy(null);
        setRows(null);
        preview({ pct, market }).then((p) => {
          setSeen(p);
          setRows(p.levels.map((l) => ({ price: l.price ?? "", pct: l.pct, why: l.why })));
        });
      },
      (e: unknown) => {
        setBusy(null);
        setError(errorOf(e, "It wasn't cancelled."));
      },
    );
  };

  const sellRows = seen?.levels ?? [];
  return (
    <section className="dcf cf" aria-label={`Take profit on ${coin}`}>
      <div className="dcf-head">
        <h2>Take profit · {coin}</h2>
        <button type="button" className="link dcf-close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="dcf-ask tp-ask">
        <div className="dcb-seg" role="group" aria-label="How much to sell">
          {PCTS.map((p) => {
            const allowed = offered.includes(p) || p === pct;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={p === pct}
                disabled={!allowed}
                title={allowed ? undefined : "Under $10 to sell, or leaves under $10"}
                onClick={() => {
                  setRows(null);
                  setPct(p);
                }}
              >
                {p}%
              </button>
            );
          })}
        </div>
        <div className="dcb-seg" role="group" aria-label="How to sell">
          <button
            type="button"
            aria-pressed={!market}
            onClick={() => {
              setRows(null);
              setMarket(false);
            }}
          >
            Limit sells
          </button>
          <button
            type="button"
            aria-pressed={market}
            onClick={() => {
              setRows(null);
              setMarket(true);
            }}
          >
            Market now
          </button>
        </div>
        <p className="muted dcf-hint">
          {seen
            ? `${label}: ${dollars(seen.value)} held, average ${seen.avg ? roundPrice(seen.avg) : "—"}, now ${roundPrice(seen.now)}. `
            : ""}
          {market
            ? "Sells now at the best price on Binance."
            : "The desk sells just under resistance, above your average after fees; each sell $10 or more."}
        </p>
      </div>

      {live.length > 0 && (
        <p className="tp-live muted">
          Waiting to sell:{" "}
          {live.map((l, k) => (
            <span key={l.ref}>
              {k > 0 && " · "}
              {l.price ? roundPrice(l.price) : "market"}
              {l.value !== null && ` (${dollars(String(l.value))})`}
              {cancelLive && (
                <button
                  type="button"
                  className="link"
                  disabled={busy === l.ref}
                  onClick={() => stopLive(l.ref)}
                >
                  {busy === l.ref ? "cancelling…" : "cancel"}
                </button>
              )}
            </span>
          ))}
        </p>
      )}

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {!rows ? (
        <p className="muted">Reading {coin}&apos;s resistance…</p>
      ) : (
        <>
          <div className="dcf-split" aria-hidden="true">
            {sellRows.map((l, i) =>
              Number(l.value) > 0 ? (
                <span
                  key={i}
                  className={`dcf-seg tone-${(i % 5) + 1}`}
                  style={{ flexGrow: Number(l.value) }}
                >
                  <b>{market ? "Now" : `Sell ${i + 1}`}</b> {Number(l.pct).toFixed(0)}%
                </span>
              ) : null,
            )}
          </div>
          <div className="dcb-scroll">
            <table className="dcb-table dcf-table" aria-label={`${coin} sells`}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th className="r">Limit</th>
                  <th className="r">% of it</th>
                  <th className="r">USDC</th>
                  <th>On your average</th>
                  <th>Why here</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(market ? sellRows.map((l) => ({ price: "", pct: l.pct, why: l.why })) : rows).map(
                  (r, i) => {
                    const s = sellRows[i];
                    const gain = s === undefined || s.gainPct === null ? null : Number(s.gainPct);
                    return (
                      <tr key={i}>
                        <td>
                          <b>{market ? "Market" : `Sell ${i + 1}`}</b>
                          {seen && <small className="dcb-id">now {roundPrice(seen.now)}</small>}
                        </td>
                        <td className="r">
                          {market ? (
                            <span className="muted">at market</span>
                          ) : (
                            <input
                              className="dcb-num"
                              aria-label={`Sell ${i + 1} price`}
                              inputMode="decimal"
                              value={r.price}
                              onChange={(e) => edit(i, "price", e.target.value)}
                            />
                          )}
                        </td>
                        <td className="r">
                          {market ? (
                            `${pct}%`
                          ) : (
                            <input
                              className="dcb-num"
                              aria-label={`Sell ${i + 1} share`}
                              inputMode="decimal"
                              value={r.pct}
                              onChange={(e) => edit(i, "pct", e.target.value)}
                            />
                          )}
                        </td>
                        <td className="r">{s ? dollars(s.value) : ""}</td>
                        <td>
                          {gain !== null && (
                            <span className={`dcf-odds${gain < 0 ? " is-low" : ""}`}>
                              <b className={gain >= 0 ? "up" : "down"}>
                                {gain >= 0 ? "+" : ""}
                                {gain.toFixed(1)}%
                              </b>
                              <i aria-hidden="true">
                                <span style={{ width: `${Math.min(100, Math.abs(gain) * 4)}%` }} />
                              </i>
                            </span>
                          )}
                        </td>
                        <td className="dcf-why muted">{r.why}</td>
                        <td>
                          {!market && rows.length > 1 && (
                            <button
                              type="button"
                              className="link"
                              aria-label={`Remove sell ${i + 1}`}
                              onClick={() => drop(i)}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
          <p className="dcb-note">
            Sells {dollars(String(total))} if every one fills
            {seen?.breakeven && <>; break-even after fees is {roundPrice(seen.breakeven)}</>}
            {seen && seen.maxLevels < 3 && !market && (
              <>
                ; {seen.maxLevels === 1 ? "one sell" : `${seen.maxLevels} sells`} at most, each $10
                or more
              </>
            )}
            .{seen?.notes.length ? ` ${seen.notes.join(" ")}` : ""}
          </p>
          {problems.length > 0 && (
            <ul className="ldr-problems" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <div className="ldr-warns" role="status">
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <label className="ldr-anyway">
                <input
                  type="checkbox"
                  checked={anyway}
                  onChange={(e) => setAnyway(e.target.checked)}
                />
                Sell anyway: I&apos;ve read the warnings
              </label>
            </div>
          )}
          <div className="dcb-plan-foot">
            {agent && strategize ? (
              <AgentChat
                agent={agent}
                chips={["Key resistance", "Where to take 25%?", "Hold or sell?"]}
                ask={(message, history) =>
                  strategize({
                    message,
                    history,
                    rows: rows.map((r) => ({ price: r.price, amount: r.pct, why: r.why })),
                  })
                }
                onPlan={(next) => {
                  const levels = next.map((r) => ({ price: r.price, pct: r.amount, why: r.why }));
                  setMarket(false);
                  setRows(levels);
                  preview({ pct, levels }).then(setSeen, () => undefined);
                }}
              />
            ) : (
              <span />
            )}
            <button
              type="button"
              className="btn btn-accent"
              disabled={!ready || (warnings.length > 0 && !anyway)}
              onClick={go}
            >
              {busy === "place"
                ? "Placing…"
                : market
                  ? `Sell ${pct}% now`
                  : `Place ${rows.length} ${rows.length === 1 ? "sell" : "sells"}`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
