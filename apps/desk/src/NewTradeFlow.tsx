// New trade by style (local/agents/trading-agent.md): pick a style, the desk's screener reads
// the 100 most-traded USDC coins on Binance (no AI), trading-agent checks the shortlist's confluence and
// catalysts, and each pick shows its grade, entry, target, stop and reward to risk, sized by
// the desk. Okay opens the review, where Approve places the order on Binance.
import { useEffect, useRef, useState } from "react";
import { getBacktests, getPotStyles, judgePot, screenPot } from "./api";
import { errorOf, inR } from "./format";
import AgentAvatar from "./AgentIcons";
import CoinIcon from "./CoinIcon";
import { dollars, qty as qtyWord } from "./dcaFormat";
import { px } from "./PotPanel";
import type {
  BacktestRunLine,
  PotJudge,
  PotLean,
  PotOdds,
  PotPick,
  PotScreen,
  PotStyle,
  PotStyleKey,
  PotStyles,
} from "./types";

export type StyleTrade = {
  coin: string;
  setup: string;
  reason: string;
  entry: string;
  stop: string;
  target: string;
  qty: string;
  spend: string;
  risk: string;
  style: PotStyleKey;
  expires: number;
  verdict: "take" | "wait" | "pass";
  odds?: PotOdds | null;
};

// How the odds read, and the tag's tone: a lean no or a coin flip is a warning, not a block.
export const LEAN: Record<PotLean, [string, string]> = {
  "strong yes": ["Strong odds", "won"],
  "leans yes": ["Odds lean yes", "won"],
  "coin flip": ["Coin flip", "live"],
  "leans no": ["Odds lean no", "lost"],
  "strong no": ["Poor odds", "lost"],
  unclear: ["Odds unclear", "live"],
};

export function OddsLine({ odds }: { odds: PotOdds }) {
  const [word, tone] = LEAN[odds.lean];
  return (
    <p className="ntf-odds">
      <span className={`pot-tag is-${tone}`}>{word}</span>
      <span>{odds.line}</span>
    </p>
  );
}

type Step = "style" | "scan" | "pick";
const STEPS = [
  ["style", "Style"],
  ["scan", "Scan"],
  ["pick", "Pick"],
  ["approve", "Approve"],
] as const;
const REGIME = { bull: "Bull", neutral: "Neutral", bear: "Bear" } as const;
const VERDICT = { take: "Take", wait: "Wait", pass: "Pass" } as const;

function left(ms: number): string {
  if (ms <= 0) return "Expired";
  const s = Math.ceil(ms / 1000);
  if (s >= 86_400) return `${Math.round(s / 86_400)} days left`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min left`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
}

function Stepper({ step }: { step: Step }) {
  const at = STEPS.findIndex(([k]) => k === step);
  return (
    <ol className="ntf-steps" aria-label="Steps">
      {STEPS.map(([key, label], i) => (
        <li
          key={key}
          className={i < at ? "is-done" : i === at ? "is-on" : ""}
          aria-current={i === at ? "step" : undefined}
        >
          <span className="ntf-dot">{i < at ? "✓" : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

// A style's newest plain backtest (the Backtest page, decision 85), as one line on its card.
function testedLine(run: BacktestRunLine | undefined): string | null {
  if (!run?.all) return null;
  const years = Math.max(1, Math.round((run.to - run.from) / (365 * 86_400_000)));
  return `Backtest, ${years} yr${years === 1 ? "" : "s"}: ${run.all.trades} trades, ${inR(run.all.avg, 2)} a trade`;
}

function StyleCard({
  s,
  tested,
  onPick,
}: {
  s: PotStyle;
  tested?: BacktestRunLine;
  onPick: () => void;
}) {
  const record = testedLine(tested);
  return (
    <button
      type="button"
      className={`ntf-style is-${s.key}`}
      disabled={!s.allowed}
      onClick={onPick}
      aria-describedby={`ntf-${s.key}-line`}
    >
      <b>{s.name}</b>
      <span id={`ntf-${s.key}-line`}>{s.line}</span>
      <small>
        Risk {s.riskPct}% · at least {s.minRr} : 1
      </small>
      {record && (
        <small className={`ntf-tested ${(tested?.all?.avg ?? 0) < 0 ? "down" : "up"}`}>
          {record}
        </small>
      )}
      {s.note && <em className={s.allowed ? "" : "is-off"}>{s.note}</em>}
    </button>
  );
}

function ScanLines({ screen, judging }: { screen: PotScreen | null; judging: boolean }) {
  const c = screen?.counts;
  const lines: [string, boolean][] = [
    [
      c
        ? `The ${c.onBinance} most-traded ${screen?.quote ?? "USDC"} coins on Binance`
        : "Reading the most-traded coins on Binance…",
      !!c,
    ],
  ];
  if (c && screen) {
    lines.push([`${c.liquid} pass ${screen.name}'s volume, rank and history rules`, true]);
    lines.push([
      `${c.setups} ${c.setups === 1 ? "has" : "have"} a setup · the best ${screen.shortlist.length} go to trading-agent`,
      true,
    ]);
    if (screen.shortlist.length > 0)
      lines.push([
        judging
          ? "trading-agent is checking confluence, catalysts and crowding…"
          : "trading-agent checked confluence, catalysts and crowding",
        !judging,
      ]);
  }
  return (
    <ul className="ntf-scan" aria-live="polite">
      {lines.map(([text, done]) => (
        <li key={text} className={done ? "is-done" : "is-busy"}>
          <span className="ntf-tick" aria-hidden="true">
            {done ? "✓" : ""}
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}

function PickCard({ p, expired, onOkay }: { p: PotPick; expired: boolean; onOkay: () => void }) {
  const sized = !p.problem && p.qty && p.risk;
  const tone = p.verdict === "take" ? "won" : p.verdict === "wait" ? "live" : "lost";
  return (
    <article className={`ntf-pick is-${p.verdict}${p.problem ? " is-refused" : ""}`}>
      <header>
        <CoinIcon coin={p.coin} />
        <b>{p.coin}</b>
        <span className="ntf-setup">{p.setup}</span>
        <span className={`pot-tag is-${tone}`}>{VERDICT[p.verdict]}</span>
        <span className={`ntf-grade is-${p.grade}`} title="trading-agent's grade">
          {p.grade}
        </span>
        <span className="ntf-score num">{p.score.toFixed(1)}</span>
      </header>
      <dl className="ntf-nums">
        <div>
          <dt>Entry</dt>
          <dd className="num">{px(p.entry)}</dd>
        </div>
        <div>
          <dt>Take profit</dt>
          <dd className="num up">{px(p.target)}</dd>
        </div>
        <div>
          <dt>Stop loss</dt>
          <dd className="num down">
            {px(p.stop)}
            {p.stopPct && <small> · {p.stopPct}%</small>}
          </dd>
        </div>
        <div>
          <dt>Reward : risk</dt>
          <dd className="num">{p.rr ? `${p.rr} : 1` : "—"}</dd>
        </div>
        <div>
          <dt>At risk</dt>
          <dd className="num">{p.risk ? dollars(p.risk) : "—"}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd className="num">
            {p.qty ? `${qtyWord(p.qty)} ${p.coin}` : "—"}
            {p.spend && <small> · {dollars(p.spend)}</small>}
          </dd>
        </div>
      </dl>
      {p.reason && <p className="ntf-thesis">{p.reason}</p>}
      <div className="ntf-case">
        <ul className="ntf-for" aria-label="For">
          {p.confluence.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        {p.against.length > 0 && (
          <ul className="ntf-against" aria-label="Against">
            {p.against.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </div>
      <p className="ntf-meta">
        <span>
          <small>Catalyst</small> {p.catalyst || "—"}
        </span>
        <span>
          <small>Crowding</small> {p.crowding || "—"}
        </span>
      </p>
      {p.odds && <OddsLine odds={p.odds} />}
      {p.problem && (
        <p className="ntf-problem" role="note">
          The desk won't place it: {p.problem}
        </p>
      )}
      <footer>
        <button
          type="button"
          className="btn btn-accent"
          disabled={!sized || expired}
          onClick={onOkay}
        >
          {expired ? "Expired" : `Okay, review ${p.coin}`}
        </button>
      </footer>
    </article>
  );
}

export default function NewTradeFlow({
  onClose,
  onHand,
  onReview,
}: {
  onClose: () => void;
  onHand: () => void;
  onReview: (t: StyleTrade) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [styles, setStyles] = useState<PotStyles | null>(null);
  const [tested, setTested] = useState<Record<string, BacktestRunLine>>({});
  const [step, setStep] = useState<Step>("style");
  const [style, setStyle] = useState<PotStyle | null>(null);
  const [screen, setScreen] = useState<PotScreen | null>(null);
  const [judge, setJudge] = useState<PotJudge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const run = useRef(0);

  useEffect(() => {
    dialog.current?.showModal?.();
    getPotStyles().then(setStyles, (e: unknown) =>
      setError(errorOf(e, "The styles couldn't be read.")),
    );
    // Each style's newest plain backtest; the cards simply go without when there's none.
    getBacktests().then(
      (v) => {
        const newest: Record<string, BacktestRunLine> = {};
        for (const run of v.runs) if (!run.ai && !newest[run.style]) newest[run.style] = run;
        setTested(newest);
      },
      () => setTested({}),
    );
  }, []);
  useEffect(() => {
    if (step !== "pick") return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [step]);

  const scan = (s: PotStyle) => {
    const mine = ++run.current;
    setStyle(s);
    setStep("scan");
    setScreen(null);
    setJudge(null);
    setError(null);
    screenPot(s.key)
      .then((found) => {
        if (mine !== run.current) return null;
        setScreen(found);
        // Nothing for trading-agent to read: stay on the scan and say so, no model call.
        if (!found.allowed || found.shortlist.length === 0) return null;
        return judgePot(s.key);
      })
      .then(
        (picked) => {
          if (mine !== run.current || !picked) return;
          setJudge(picked);
          setNow(Date.now());
          setStep("pick");
        },
        (e: unknown) => {
          if (mine === run.current) setError(errorOf(e, "The scan didn't finish."));
        },
      );
  };
  const back = () => {
    run.current++;
    setStep("style");
    setError(null);
  };

  const expired = judge ? now > judge.expires : false;
  const regime = styles?.regime ?? screen?.regime;

  return (
    <dialog ref={dialog} className="dcb-drawer ntf" aria-labelledby="ntf-title" onClose={onClose}>
      <header className="dcb-drawer-head">
        <h2 id="ntf-title">New trade</h2>
        <small className="dcb-id">
          {regime?.state ? `Market: ${REGIME[regime.state]}` : "Market: reading…"}
          {regime?.words ? ` · ${regime.words}` : ""}
        </small>
        <button
          type="button"
          className="link dcb-drawer-close"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </header>
      <Stepper step={step} />

      <div className="ntf-body" key={step}>
        {step === "style" && (
          <section aria-label="Pick a style">
            <p className="muted">
              Pick how long you mean to hold. The desk scans the 100 most-traded USDC coins on
              Binance by that style's rules, then trading-agent checks the best few.
            </p>
            {styles ? (
              <div className="ntf-styles">
                {styles.styles.map((s) => (
                  <StyleCard key={s.key} s={s} tested={tested[s.key]} onPick={() => scan(s)} />
                ))}
              </div>
            ) : (
              !error && <p className="muted">Reading the market…</p>
            )}
            {Object.keys(tested).length > 0 && (
              <a className="link ntf-backtests" href="#/backtest">
                See every backtest →
              </a>
            )}
            <button type="button" className="link ntf-hand" onClick={onHand}>
              Set one up yourself →
            </button>
          </section>
        )}

        {step === "scan" && style && (
          <section aria-label={`Scanning for ${style.name}`}>
            <h3 className="ntf-h">
              <AgentAvatar icon="research" slug="trading-agent" /> {style.name} · {style.line}
            </h3>
            {screen && !screen.allowed ? (
              <p className="ntf-off">{screen.note}</p>
            ) : (
              <ScanLines screen={screen} judging={!!screen && !judge && !error} />
            )}
            {screen?.allowed && screen.shortlist.length === 0 && (
              <p className="ntf-off">
                No {style.name.toLowerCase()} setups right now:{" "}
                {screen.counts.liquid === 0
                  ? "no coin passed the volume, rank and history rules."
                  : `${screen.counts.liquid} ${screen.counts.liquid === 1 ? "coin passed" : "coins passed"} the rules, but none is at a setup on the last candle. trading-agent wasn't asked.`}
                {screen.note ? ` ${screen.note}` : ""}
              </p>
            )}
            {screen?.allowed && screen.shortlist.length === 0 && screen.block && (
              <p className="ntf-warn">{screen.block}</p>
            )}
            {screen?.allowed && screen.shortlist.length === 0 && screen.misses.length > 0 && (
              <div className="ntf-misses">
                <small>Closest to a setup</small>
                <ul>
                  {screen.misses.map((m) => (
                    <li key={m.coin}>
                      <CoinIcon coin={m.coin} />
                      <b>{m.coin}</b>
                      <span>{m.why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(error || (screen && (!screen.allowed || screen.shortlist.length === 0))) && (
              <div className="dlg-btns">
                <button type="button" className="btn" onClick={back}>
                  Another style
                </button>
                <button type="button" className="btn btn-accent" onClick={() => scan(style)}>
                  Scan again
                </button>
              </div>
            )}
          </section>
        )}

        {step === "pick" && style && judge && (
          <section aria-label="Pick an opportunity">
            <div className="ntf-pick-head">
              <p>
                <AgentAvatar icon="research" slug="trading-agent" /> {judge.line}
              </p>
              <span className={`ntf-clock${expired ? " is-out" : ""}`} aria-live="off">
                {left(judge.expires - now)}
              </span>
            </div>
            {judge.warnings.map((w) => (
              <p key={w} className="ntf-warn">
                {w}
              </p>
            ))}
            {judge.picks.length === 0 ? (
              <p className="ntf-off">trading-agent passed on every setup this time.</p>
            ) : (
              <div className="ntf-picks">
                {judge.picks.map((p) => (
                  <PickCard
                    key={p.coin}
                    p={p}
                    expired={expired}
                    onOkay={() =>
                      onReview({
                        coin: p.coin,
                        setup: p.setup,
                        reason: p.reason,
                        entry: p.entry,
                        stop: p.stop,
                        target: p.target,
                        qty: p.qty ?? "0",
                        spend: p.spend ?? "0",
                        risk: p.risk ?? "0",
                        style: style.key,
                        verdict: p.verdict,
                        odds: p.odds ?? null,
                        expires: judge.expires,
                      })
                    }
                  />
                ))}
              </div>
            )}
            <div className="dlg-btns">
              <button type="button" className="btn" onClick={back}>
                Another style
              </button>
              <button type="button" className="btn" onClick={() => scan(style)}>
                Scan again
              </button>
            </div>
          </section>
        )}

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
