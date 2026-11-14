import { useEffect, useState } from "react";
import { ApiError, getSentiment, getWatchlist } from "./api";
import CoinIcon from "./CoinIcon";
import { percent, trend } from "./format";
import type { Holding, Sentiment, Verdict, Watchlist } from "./types";

// Compact Dashboard widgets (design-system 19): Fear & Greed, top movers and AI signals.

type Load<T> =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: T };

function useLoad<T>(get: () => Promise<T>): Load<T> {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  useEffect(() => {
    get().then(
      (data) => setState({ kind: "ready", data }),
      (e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof ApiError ? e.message : "Couldn't be read.",
        }),
    );
  }, [get]); // a module-level function, so loaded once per visit to the Dashboard
  return state;
}

// The Crypto Fear & Greed Index (decision 36): 0 extreme fear, 100 extreme greed.
const FEAR_BELOW = 45;
const GREED_ABOVE = 55;
function mood(value: number): "down" | "wait" | "up" {
  if (value < FEAR_BELOW) return "down";
  return value > GREED_ABOVE ? "up" : "wait";
}

export function FearGreed() {
  const state = useLoad<Sentiment>(getSentiment);
  return (
    <section className="card stat widget" aria-label="Fear and Greed Index">
      <div className="kv" style={{ padding: 0 }}>
        <span className="label">Fear &amp; Greed</span>
        <span className="label muted">Crypto, today</span>
      </div>
      {state.kind === "loading" && (
        <div className="skeleton" style={{ height: 60, marginTop: 10 }} />
      )}
      {state.kind === "error" && <p className="muted widget-note">{state.message}</p>}
      {state.kind === "ready" && (
        <>
          <div className="fg-row">
            <span className={`big num ${mood(state.data.value)}`}>{state.data.value}</span>
            <span className={`fg-label ${mood(state.data.value)}`}>{state.data.label}</span>
          </div>
          <div className="fg-gauge" aria-hidden="true">
            <i style={{ left: `${state.data.value}%` }} />
          </div>
          <div className="fg-scale muted" aria-hidden="true">
            <span>Fear</span>
            <span>Greed</span>
          </div>
          {state.data.yesterday !== null && (
            <div className="muted widget-note num">Yesterday {state.data.yesterday}</div>
          )}
        </>
      )}
    </section>
  );
}

// The biggest moves in 24 hours among what's held: the four biggest gains or the four biggest
// losses, biggest first; it opens on whichever side moved most.
const SHOWN = 4;
type Way = "gained" | "lost";

export function Movers({ holdings }: { holdings: Holding[] }) {
  const seen = new Set<string>();
  const moved = holdings
    .filter((h) => h.change24h !== null && !["USDT", "USDC", "FDUSD"].includes(h.asset))
    .filter((h) => !seen.has(h.asset) && Boolean(seen.add(h.asset))); // one row a coin
  const gained = moved
    .filter((h) => Number(h.change24h) > 0)
    .sort((a, b) => Number(b.change24h) - Number(a.change24h));
  const lost = moved
    .filter((h) => Number(h.change24h) <= 0)
    .sort((a, b) => Number(a.change24h) - Number(b.change24h));
  const biggest = (list: Holding[]) => Math.abs(Number(list[0]?.change24h ?? 0));
  const [picked, setPicked] = useState<Way | null>(null);
  const way: Way = picked ?? (biggest(gained) >= biggest(lost) ? "gained" : "lost");
  const rows = (way === "gained" ? gained : lost).slice(0, SHOWN);
  return (
    <section className="card stat widget" aria-label="Top movers">
      <div className="kv" style={{ padding: 0 }}>
        <span className="label">Top movers · 24h</span>
        <div className="seg movers-seg" role="group" aria-label="Show">
          {(["gained", "lost"] as const).map((w) => (
            <button
              key={w}
              type="button"
              className={way === w ? "on" : ""}
              aria-pressed={way === w}
              onClick={() => setPicked(w)}
            >
              {w === "gained" ? "Gained" : "Lost"}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted widget-note">
          {moved.length === 0 ? "Nothing held moved yet." : `Nothing ${way} in 24 hours.`}
        </p>
      ) : (
        <ul className="widget-list">
          {rows.map((h) => (
            <li key={`${h.asset}-${h.source}`} className="kv">
              <span className="coin">
                <CoinIcon coin={h.asset} />
                {h.asset}
              </span>
              <span className={`num ${trend(h.change24h)}`}>{percent(h.change24h)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The watchlist's AI verdicts at a glance (decision 16), and which coins say Buy now.
const VERDICTS: [Verdict, string][] = [
  ["Buy now", "up"],
  ["Wait", "wait"],
  ["Avoid", "down"],
];

const loadWatchlist = () => getWatchlist();

export function Signals() {
  const state = useLoad<Watchlist>(loadWatchlist);
  return (
    <section className="card stat widget" aria-label="AI signals">
      <div className="kv" style={{ padding: 0 }}>
        <span className="label">AI signals</span>
        <a className="label" href="#/trade">
          {state.kind === "ready" ? state.data.list.name : "Watchlist"}
        </a>
      </div>
      {state.kind === "loading" && (
        <div className="skeleton" style={{ height: 60, marginTop: 10 }} />
      )}
      {state.kind === "error" && <p className="muted widget-note">{state.message}</p>}
      {state.kind === "ready" &&
        (() => {
          const coins = state.data.coins;
          const count = (v: Verdict) => coins.filter((c) => c.signal?.verdict === v).length;
          const none = coins.filter((c) => !c.signal).length;
          const buys = coins.filter((c) => c.signal?.verdict === "Buy now").map((c) => c.coin);
          return (
            <>
              <div className="sig-counts">
                {VERDICTS.map(([v, tone]) => (
                  <div key={v}>
                    <span className={`big num ${count(v) ? tone : "muted"}`}>{count(v)}</span>
                    <span className="muted">{v}</span>
                  </div>
                ))}
              </div>
              <div className="muted widget-note">
                {buys.length ? `Buy now: ${buys.join(", ")}` : "No coin says Buy now"}
                {none ? ` · ${none} without a signal` : ""}
              </div>
            </>
          );
        })()}
    </section>
  );
}
