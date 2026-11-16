// A trade by hand: the owner picks the coin, entry, stop and target and says why. The api sizes
// it as it's typed (POST /pot/preview) and names every rule it breaks; the ladder draws the
// stop, entry, target, +1R and the price now, so the trade is seen before the review.
import { useEffect, useRef, useState } from "react";
import { previewPotTrade } from "./api";
import CoinIcon from "./CoinIcon";
import { dollars, qty as qtyWord } from "./dcaFormat";
import { px } from "./PotPanel";
import type { PotPreview } from "./types";

export type HandTrade = {
  coin: string;
  setup: string;
  reason: string;
  entry: string;
  stop: string;
  target: string;
  qty: string;
  spend: string;
  risk: string;
};

const SETUPS = ["Pullback", "Breakout", "Range low", "Reclaim"] as const;
const REVIEW_DAYS = [3, 7, 14] as const;
const errorOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const ok = (v: string) => Number(v) > 0 && Number.isFinite(Number(v));

// A price to the pair's step, so a quick pick is a price Binance takes.
function toTick(value: number, tick: string | null): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (!tick) return String(Number(value.toPrecision(6)));
  const places = (tick.split(".")[1] ?? "").replace(/0+$/, "").length;
  const step = Number(tick);
  return (Math.floor(value / step + 1e-9) * step).toFixed(places);
}

function reviewDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

// The note kept with the trade: why, what would prove it wrong, and when to look again.
export function noteOf(why: string, wrong: string, days: number | null): string {
  const parts = [why.trim().replace(/\.?$/, ".")];
  if (wrong.trim())
    parts.push(
      `Wrong if ${wrong
        .trim()
        .replace(/^wrong if /i, "")
        .replace(/\.?$/, ".")}`,
    );
  if (days) parts.push(`Review by ${reviewDate(days)}.`);
  return parts.join(" ").slice(0, 400);
}

// The trade standing up: target at the top, stop at the bottom, the price now across it.
function TradeLadder({
  entry,
  stop,
  target,
  now,
  coin,
}: {
  entry: number;
  stop: number;
  target: number;
  now: number | null;
  coin: string;
}) {
  const valid = stop > 0 && stop < entry && entry < target;
  if (!valid) {
    return (
      <div className="pnt-ladder is-empty" aria-hidden="true">
        <span>Set a stop under the entry and a target above it to see the trade.</span>
      </div>
    );
  }
  const top = Math.max(target, now ?? target);
  const bottom = Math.min(stop, now ?? stop);
  const pad = (top - bottom) * 0.08;
  const hi = top + pad;
  const span = hi - (bottom - pad);
  const y = (v: number) => `${((hi - v) / span) * 100}%`;
  const pct = (v: number) =>
    `${v >= entry ? "+" : "−"}${Math.abs((v / entry - 1) * 100).toFixed(1)}%`;
  const oneR = entry + (entry - stop);
  return (
    <div
      className="pnt-ladder"
      role="img"
      aria-label={`${coin}: target ${px(target)}, entry ${px(entry)}, stop ${px(stop)}${now ? `, now ${px(now)}` : ""}`}
    >
      <span
        className="pnt-zone is-win"
        style={{ top: y(target), height: `calc(${y(entry)} - ${y(target)})` }}
      />
      <span
        className="pnt-zone is-loss"
        style={{ top: y(entry), height: `calc(${y(stop)} - ${y(entry)})` }}
      />
      <span className="pnt-line is-target" style={{ top: y(target) }}>
        <span>
          <b>Target</b> <span className="num">{px(target)}</span>{" "}
          <small className="num">{pct(target)}</small>
        </span>
      </span>
      {oneR < target && (
        <span className="pnt-line is-faint" style={{ top: y(oneR) }}>
          <span>
            <b>+1R</b> <span className="num">{px(oneR)}</span>
          </span>
        </span>
      )}
      <span className="pnt-line is-entry" style={{ top: y(entry) }}>
        <span>
          <b>Entry</b> <span className="num">{px(entry)}</span>
        </span>
      </span>
      <span className="pnt-line is-stop" style={{ top: y(stop) }}>
        <span>
          <b>Stop</b> <span className="num">{px(stop)}</span>{" "}
          <small className="num">{pct(stop)}</small>
        </span>
      </span>
      {now !== null && (
        <span className="pnt-now" style={{ top: y(now) }}>
          <span>
            <b>Now</b> <span className="num">{px(now)}</span>
          </span>
        </span>
      )}
    </div>
  );
}

export default function PotNewTrade({
  coins,
  onClose,
  onReview,
}: {
  coins: string[];
  onClose: () => void;
  onReview: (trade: HandTrade) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [coin, setCoin] = useState(coins[0] ?? "BTC");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [setup, setSetup] = useState<string>(SETUPS[0]);
  const [why, setWhy] = useState("");
  const [wrong, setWrong] = useState("");
  const [days, setDays] = useState<number | null>(7);
  const [seen, setSeen] = useState<PotPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  // A new coin starts at its price now, with the stop and target to be set.
  const pick = (c: string) => {
    if (c === coin) return;
    setSeen(null);
    setEntry("");
    setStop("");
    setTarget("");
    setCoin(c);
  };
  useEffect(() => {
    let current = true;
    previewPotTrade({ coin }).then(
      (p) => {
        if (!current) return;
        setSeen(p);
        setEntry(p.now ?? "");
        setError(null);
      },
      (e: unknown) => current && setError(errorOf(e, "Binance didn't answer.")),
    );
    return () => {
      current = false;
    };
  }, [coin]);

  // Sized as it's typed, a moment after the last key.
  const complete = ok(entry) && ok(stop) && ok(target);
  const key = JSON.stringify([coin, entry, stop, target]);
  const reading = complete && answered !== key;
  useEffect(() => {
    if (!complete) return;
    let current = true;
    const wait = window.setTimeout(() => {
      previewPotTrade({ coin, entry, stop, target }).then(
        (p) => {
          if (!current) return;
          setSeen(p);
          setAnswered(key);
          setError(null);
        },
        (e: unknown) => {
          if (!current) return;
          setAnswered(key);
          setError(errorOf(e, "That couldn't be sized."));
        },
      );
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(wait);
    };
  }, [complete, key, coin, entry, stop, target]);

  const sized = complete ? (seen?.trade ?? null) : null;
  const problems = complete ? (seen?.problems ?? []) : [];
  const e = Number(entry);
  const s = Number(stop);
  const now = seen?.now ? Number(seen.now) : null;
  const rrNum = sized ? Number(sized.rr) : null;
  const ready = sized !== null && problems.length === 0 && !reading && why.trim().length >= 10;

  const stopAt = (pct: number) => setStop(toTick(e * (1 - pct / 100), seen?.tick ?? null));
  const targetAt = (r: number) => setTarget(toTick(e + (e - s) * r, seen?.tick ?? null));

  return (
    <dialog ref={dialog} className="dcb-drawer pnt" aria-labelledby="pnt-title" onClose={onClose}>
      <header className="dcb-drawer-head">
        <h2 id="pnt-title">New trade</h2>
        <small className="dcb-id">
          {seen?.ref ? `Will be ${seen.ref}` : "Its reference comes with the coin"}
        </small>
        <button
          type="button"
          className="link dcb-drawer-close"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </header>

      <div className="pnt-coins" role="radiogroup" aria-label="Coin">
        {coins.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === coin}
            className={`pnt-chip${c === coin ? " is-on" : ""}`}
            onClick={() => pick(c)}
          >
            <CoinIcon coin={c} />
            {c}
          </button>
        ))}
      </div>

      <div className="pnt-body">
        <div className="pnt-form">
          <p className="pnt-now-line muted">
            {coin} now <b className="num">{seen?.now ? px(seen.now) : "…"}</b> USDC. A limit buy
            goes at or under it.
          </p>
          <label className="pnt-field">
            <span>Entry, limit buy</span>
            <input
              inputMode="decimal"
              value={entry}
              onChange={(ev) => setEntry(ev.target.value)}
              aria-label="Entry price"
            />
          </label>
          <label className="pnt-field is-stop">
            <span>Stop loss</span>
            <input
              inputMode="decimal"
              value={stop}
              onChange={(ev) => setStop(ev.target.value)}
              aria-label="Stop loss price"
            />
          </label>
          <div className="pnt-quick" aria-label="Stop under the entry by">
            {[3, 5, 8].map((p) => (
              <button
                key={p}
                type="button"
                className="btn btn-small"
                disabled={!ok(entry)}
                onClick={() => stopAt(p)}
              >
                −{p}%
              </button>
            ))}
          </div>
          <label className="pnt-field is-target">
            <span>Take profit</span>
            <input
              inputMode="decimal"
              value={target}
              onChange={(ev) => setTarget(ev.target.value)}
              aria-label="Take profit price"
            />
          </label>
          <div className="pnt-quick" aria-label="Target at a multiple of the risk">
            {[2, 2.5, 3].map((r) => (
              <button
                key={r}
                type="button"
                className="btn btn-small"
                disabled={!(ok(entry) && ok(stop) && s < e)}
                onClick={() => targetAt(r)}
              >
                {r}R
              </button>
            ))}
          </div>

          <fieldset className="pnt-setup">
            <legend>Setup</legend>
            {SETUPS.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={setup === name}
                className={`pnt-chip${setup === name ? " is-on" : ""}`}
                onClick={() => setSetup(name)}
              >
                {name}
              </button>
            ))}
          </fieldset>
          <label className="pnt-field is-text">
            <span>Why this trade</span>
            <textarea
              rows={2}
              maxLength={240}
              value={why}
              onChange={(ev) => setWhy(ev.target.value)}
              placeholder="Held its 50-day twice this week on falling volume."
            />
          </label>
          <label className="pnt-field is-text">
            <span>
              Wrong if <small className="muted">(optional)</small>
            </span>
            <input
              maxLength={100}
              value={wrong}
              onChange={(ev) => setWrong(ev.target.value)}
              placeholder="it closes a day under the 50-day"
            />
          </label>
          <div className="pnt-days" role="radiogroup" aria-label="Look at it again by">
            <span className="muted">Review by</span>
            {REVIEW_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={days === d}
                className={`pnt-chip${days === d ? " is-on" : ""}`}
                onClick={() => setDays(days === d ? null : d)}
              >
                {d} days
              </button>
            ))}
          </div>
        </div>

        <div className="pnt-side">
          <TradeLadder coin={coin} entry={e} stop={s} target={Number(target)} now={now} />
          {sized && (
            <dl className="pnt-figures" aria-label="The trade's numbers" aria-busy={reading}>
              <div className="is-big">
                <dt>Reward to risk</dt>
                <dd className={`num ${rrNum !== null && rrNum >= 2 ? "up" : "down"}`}>
                  {sized.rr} : 1
                </dd>
              </div>
              <div className="is-big">
                <dt>At risk</dt>
                <dd className="num down">
                  {dollars(sized.risk)}{" "}
                  <small className="muted">{sized.riskOfPot}% of the pot</small>
                </dd>
              </div>
              <div className="is-big">
                <dt>To gain</dt>
                <dd className="num up">{dollars(sized.reward)}</dd>
              </div>
              <div>
                <dt>Position</dt>
                <dd className="num">
                  {dollars(sized.spend)}{" "}
                  <small className="muted">
                    {qtyWord(sized.qty)} {coin}
                  </small>
                </dd>
              </div>
              <div>
                <dt>Stop, target</dt>
                <dd className="num">
                  <span className="down">−{sized.stopPct}%</span>,{" "}
                  <span className="up">+{sized.targetPct}%</span>
                </dd>
              </div>
              <div>
                <dt>Wins needed to break even</dt>
                <dd className="num">{rrNum ? `${Math.round(100 / (1 + rrNum))}%` : "—"}</dd>
              </div>
              <div>
                <dt>Breakeven, after fees</dt>
                <dd className="num">{px(sized.breakeven)}</dd>
              </div>
              <div>
                <dt>Fees, both sides</dt>
                <dd className="num">{dollars(sized.fees)}</dd>
              </div>
              <div>
                <dt>A trade allows</dt>
                <dd className="num">{dollars(sized.allowed)} at risk</dd>
              </div>
            </dl>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {sized && (
            <div className={`pnt-rules${problems.length ? " is-broken" : ""}`} role="status">
              {problems.length === 0 ? (
                <p>
                  <b>Every rule kept:</b> size, risk, 2 : 1 after fees, open risk, the month's
                  limit, the regime, your per-order and daily limits.
                </p>
              ) : (
                <ul aria-label="Rules it breaks">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!sized && problems.length > 0 && (
            <div className="pnt-rules is-broken" role="status">
              <ul aria-label="Rules it breaks">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <footer className="pnt-foot">
        <span className="muted">
          {ready
            ? "Review shows the three orders before anything goes to Binance."
            : !sized
              ? "Set the stop and target to size it."
              : problems.length
                ? "Change the trade until every rule is kept."
                : reading
                  ? "Sizing…"
                  : "Say why in a line: it's kept with the trade for the review."}
        </span>
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>
          Not now
        </button>
        <button
          type="button"
          className="btn btn-accent"
          disabled={!ready}
          onClick={() => {
            if (!sized) return;
            onReview({
              coin,
              setup,
              reason: noteOf(why, wrong, days),
              entry: sized.entry,
              stop: sized.stop,
              target: sized.target,
              qty: sized.qty,
              spend: sized.spend,
              risk: sized.risk,
            });
          }}
        >
          Review
        </button>
      </footer>
    </dialog>
  );
}
