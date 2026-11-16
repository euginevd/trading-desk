// The Trade page (TODO 6): a workspace with the trading agent, in three columns. Left, the coins
// with the agent's last call on each; centre, the agent: Analyse, its steps as they land, its
// call and a follow-up question; right, the chart with the agent's levels and the Profile's
// guardrails. Orders open in a sheet the owner reviews and confirms.
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  addAlert,
  askAnalysis,
  deleteAlert,
  getAlerts,
  chooseTicket,
  getAnalysisCalls,
  getLastAnalysis,
  getMarket,
  getTerminal,
  getTradingAgent,
  getWatchlist,
  nextAnalysisStep,
  rankCoins,
  startAnalysis,
} from "./api";
import Coins from "./Coins";
import { amount, percent, trend, usd } from "./format";
import OrderSheet, { type SheetStart } from "./OrderSheet";
import SmartTradePanel from "./SmartTrade";
import { AgentHero, Asks, RunHeader, TicketCard, Timeline } from "./TradeAgent";
import { km } from "./Figures";
import { big } from "./format";
import { AlertsCard, GuardrailsCard, LevelsCard, PriceCard } from "./TradeContext";
import type {
  AgentCall,
  AgentPage,
  AgentRun,
  CoinRank,
  Market,
  PriceAlert,
  Settings,
  Terminal,
  TicketChoice,
  Watchlist,
} from "./types";
import type { Status } from "./ui";
import "./trade.css";

const WATCH_MS = 30_000;
// Another request holding a run's step: wait and ask again, up to about a minute.
const BUSY_MS = 2_000;
const BUSY_TRIES = 30;

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

export default function Trade({
  settings,
  onSettings,
  onStatus,
}: {
  settings: Settings | null;
  onSettings: (s: Settings) => void;
  onStatus: (status: Status) => void;
}) {
  const [list, setList] = useState<Watchlist | null>(null);
  const [selected, setSelected] = useState("");
  const [calls, setCalls] = useState<AgentCall[]>([]);
  const [ranked, setRanked] = useState<{ ranked: CoinRank[]; cost: string } | null>(null);
  const [ranking, setRanking] = useState(false);
  const [rankError, setRankError] = useState("");
  const [market, setMarket] = useState<Market | null>(null);
  const [terminal, setTerminal] = useState<{ coin: string; data: Terminal } | null>(null);
  const [agent, setAgent] = useState<AgentPage | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [lastFor, setLastFor] = useState(""); // the coin whose last run has been read
  const [working, setWorking] = useState(false);
  const [runError, setRunError] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [view, setView] = useState<"agent" | "orders">("agent");
  const [sheet, setSheet] = useState<SheetStart | null>(null);
  const [smartPrefill, setSmartPrefill] = useState<{
    side: "buy" | "sell";
    price: string;
    n: number;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [alerts, setAlerts] = useState<{ coin: string; list: PriceAlert[] } | null>(null);
  const [alertError, setAlertError] = useState("");
  const opened = useRef(0); // numbers each sheet, so a new one starts fresh

  // A link from elsewhere (the Portfolio's drift card, decision 55) opens a coin with its order
  // filled in: #/trade?coin=TAO&side=sell&price=410&qty=0.8&why=rebalance. Nothing is sent.
  useEffect(() => {
    const read = () => {
      const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
      const coin = query.get("coin")?.toUpperCase();
      const side = query.get("side");
      if (!coin || !/^[A-Z0-9]{1,15}$/.test(coin) || (side !== "buy" && side !== "sell")) return;
      setSelected(coin);
      opened.current += 1;
      setSheet({
        n: opened.current,
        side,
        price: query.get("price") ?? "",
        qty: query.get("qty") ?? "",
        from: "link",
        why: query.get("why") ?? undefined,
      });
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const shownList = useRef(0); // the watchlist on screen, so a reload keeps it
  const loadList = useCallback(
    () =>
      getWatchlist(shownList.current || undefined).then(
        (next) => {
          shownList.current = next.list.id;
          setList(next);
          setSelected((s) => s || next.coins[0]?.coin || "BTC");
        },
        (e: unknown) => {
          setError(message(e));
          onStatus("disconnected");
        },
      ),
    [onStatus],
  );
  const loadCalls = useCallback(
    () =>
      getAnalysisCalls().then(
        (r) => {
          setCalls(r.calls);
          setNow(Date.now());
        },
        () => setCalls([]),
      ),
    [],
  );
  const loadTerminal = useCallback(
    (coin: string) =>
      getTerminal(coin).then(
        (data) => {
          setTerminal({ coin, data });
          onSettings(data.settings);
          onStatus(data.demo ? "demo" : "connected");
        },
        (e: unknown) => {
          setError(message(e));
          onStatus("disconnected");
        },
      ),
    [onSettings, onStatus],
  );

  useEffect(() => {
    void loadList();
    void loadCalls();
    getTradingAgent().then(setAgent, () => setAgent(null));
  }, [loadList, loadCalls]);

  useEffect(() => {
    if (!selected) return;
    getMarket(selected, "4h").then(setMarket, (e: unknown) => setError(message(e)));
    void loadTerminal(selected);
    const timer = window.setInterval(() => void loadTerminal(selected), WATCH_MS);
    return () => window.clearInterval(timer);
  }, [selected, loadTerminal]);

  // A run is driven from here, one step a call, until it isn't running, and only after the
  // owner presses Analyse or Continue. Switching coin or leaving the page stops the loop; a run
  // found part way shows as paused.
  const token = useRef(0);
  const drive = useCallback(
    async (start: () => Promise<AgentRun>) => {
      const mine = ++token.current;
      setWorking(true);
      setRunError("");
      try {
        let next = await start();
        if (token.current !== mine) return;
        setRun(next);
        let waits = 0;
        while (next.status === "running") {
          if (next.busy) {
            waits += 1;
            if (waits > BUSY_TRIES) {
              setRunError(
                "Another window is still working on this run. Wait a minute, then press Continue.",
              );
              return;
            }
            await new Promise((done) => window.setTimeout(done, BUSY_MS));
            if (token.current !== mine) return;
          } else waits = 0;
          next = await nextAnalysisStep(next.id);
          if (token.current !== mine) return;
          setRun(next);
        }
        void loadCalls();
      } catch (e: unknown) {
        if (token.current === mine) setRunError(message(e));
      } finally {
        if (token.current === mine) setWorking(false);
      }
    },
    [loadCalls],
  );
  useEffect(
    () => () => {
      token.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!selected) return;
    let live = true;
    getLastAnalysis(selected).then(
      (r) => {
        if (!live) return;
        setLastFor(selected);
        setRun(r.run);
      },
      () => live && setLastFor(selected),
    );
    getAlerts(selected).then(
      (r) => live && setAlerts({ coin: selected, list: r.alerts }),
      (e: unknown) => live && setAlertError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [selected]);

  const alertsDone = (coin: string) => (r: { alerts: PriceAlert[] }) => {
    setAlertError("");
    setAlerts({ coin, list: r.alerts.filter((a) => a.coin === coin) });
  };
  const setAlert = (w: { price: string; direction: "above" | "below"; note: string }) =>
    addAlert({ coin: selected, ...w }).then(alertsDone(selected), (e: unknown) =>
      setAlertError(message(e)),
    );
  const removeAlert = (id: number) =>
    deleteAlert(id).then(alertsDone(selected), (e: unknown) => setAlertError(message(e)));

  const select = (coin: string) => {
    if (coin === selected) return;
    token.current += 1; // the old coin's run stops driving
    setSelected(coin);
    setRun(null);
    setWorking(false);
    setRunError("");
    setAskError("");
    setDone("");
    setMarket(null);
    setAlertError("");
  };

  const changed = (next: Watchlist, added?: string) => {
    shownList.current = next.list.id;
    setList(next);
    if (added) select(added);
    else if (!next.coins.some((c) => c.coin === selected)) select(next.coins[0]?.coin ?? "BTC");
  };

  const rank = () => {
    setRanking(true);
    setRankError("");
    rankCoins(list?.coins.map((c) => c.coin) ?? [])
      .then(setRanked, (e: unknown) => setRankError(message(e)))
      .finally(() => setRanking(false));
  };

  const shown = run?.coin === selected ? run : null;
  const term = terminal?.coin === selected ? terminal.data : null;
  const shownMarket = market?.coin === selected ? market : null;
  const live = settings ?? term?.settings ?? null;
  const name = shown?.agent.name || agent?.agent.name || "your agent";
  const shownAlerts = alerts?.coin === selected ? alerts.list : null;

  const choose = (choice: TicketChoice) => {
    if (!shown) return;
    setChoosing(true);
    chooseTicket(shown.id, choice)
      .then(setRun, (e: unknown) => setRunError(`Your choice wasn't logged: ${message(e)}`))
      .finally(() => setChoosing(false));
  };
  // Use and Edit only fill the sheet; the choice is logged once that order is placed.
  const openTicket = (choice: "used" | "edited") => {
    const t = shown?.ticket;
    if (!shown || !t) return;
    opened.current += 1;
    setSheet({
      n: opened.current,
      side: t.side,
      price: t.price,
      qty: t.qty,
      from: "agent",
      ticket: t,
      choice: { runId: shown.id, choice },
      audPerUsd: shown.guardrails.audPerUsd,
    });
  };
  const openOwn = () => {
    opened.current += 1;
    setSheet({
      n: opened.current,
      side: "buy",
      price: "",
      qty: "",
      from: "own",
      audPerUsd: shown?.guardrails.audPerUsd,
    });
  };

  const ask = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!shown || !q) return;
    setAsking(true);
    setAskError("");
    askAnalysis(shown.id, q)
      .then(
        (next) => {
          setRun(next);
          setQuestion("");
        },
        (err: unknown) => setAskError(message(err)),
      )
      .finally(() => setAsking(false));
  };

  const after = (problem?: string, note?: string) => {
    setError(problem ?? "");
    setDone(note ?? "");
    if (selected) void loadTerminal(selected);
  };

  const canAsk = shown !== null && shown.status !== "running" && !asking;
  const coin = selected || "…";
  const pos = shown?.position;
  const ordersCount = term?.openOrders.length ?? 0;

  return (
    <main className="tr">
      <Coins
        list={list}
        selected={selected}
        calls={calls}
        ranked={ranked}
        ranking={ranking}
        rankError={rankError}
        now={now}
        onSelect={select}
        onChange={changed}
        onRank={rank}
      />

      <section className="tr-col tr-centre" aria-label="Trading agent">
        <div className="tr-scroll">
          <div className="tr-wrap">
            <div className="tr-pair">
              <h1>{coin}</h1>
              {shownMarket ? (
                <>
                  <span className="tr-price num">{big(shownMarket.price)}</span>
                  <span className={`num ${trend(shownMarket.change24h)}`}>
                    {percent(shownMarket.change24h)} today
                  </span>
                </>
              ) : (
                <span className="skeleton tr-price-skeleton" aria-hidden="true" />
              )}
              {term?.demo && <span className="tag wait">Demo exchange</span>}
              <span className="spacer" />
              <button type="button" className="link" disabled={!term || !live} onClick={openOwn}>
                Place my own order
              </button>
            </div>

            {pos || term ? (
              <dl className="tr-strip" aria-label="Your position">
                {pos ? (
                  <>
                    <div>
                      <dt>You hold</dt>
                      <dd className="num">
                        {pos.held ? `${amount(pos.qty)} ${shown.coin}` : "None"}
                      </dd>
                    </div>
                    <div>
                      <dt>Value</dt>
                      <dd className="num" title={usd(pos.value)}>
                        {km(pos.value, "US$")}
                      </dd>
                    </div>
                    <div>
                      <dt>Average</dt>
                      <dd className="num">
                        {big(pos.avgCost)}{" "}
                        {pos.pnlPct !== null && (
                          <span className={trend(pos.pnlPct)}>{percent(pos.pnlPct)}</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Cash</dt>
                      <dd className="num" title={usd(shown.cashUsd)}>
                        {km(shown.cashUsd, "US$")}
                      </dd>
                    </div>
                  </>
                ) : (
                  term && (
                    <>
                      <div>
                        <dt>Free on Binance</dt>
                        <dd className="num">
                          {amount(term.baseFree)} {term.base}
                        </dd>
                      </div>
                      <div>
                        <dt>Cash</dt>
                        <dd className="num">
                          {amount(term.quoteFree)} {term.quote}
                        </dd>
                      </div>
                    </>
                  )
                )}
              </dl>
            ) : (
              <div className="skeleton tr-strip-skeleton" aria-hidden="true" />
            )}

            <div className="tabs tr-tabs" role="tablist" aria-label="Agent or orders">
              <button
                type="button"
                role="tab"
                aria-selected={view === "agent"}
                onClick={() => setView("agent")}
              >
                {shown?.agent.name || agent?.agent.name || "Agent"}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "orders"}
                onClick={() => setView("orders")}
              >
                Orders and smart trades ({ordersCount})
              </button>
            </div>

            {error && (
              <div className="alert" role="alert">
                <span>{error}</span>
              </div>
            )}
            {done && (
              <div className="alert done" role="status">
                <span>{done}</span>
              </div>
            )}

            {view === "orders" ? (
              term && live ? (
                <SmartTradePanel
                  prefill={smartPrefill}
                  terminal={term}
                  settings={live}
                  signal={shown?.signal ?? null}
                  market={shownMarket}
                  onPlaced={(note) => after(undefined, note)}
                  onSettings={(next) => {
                    onSettings(next);
                    after();
                  }}
                  onDone={(problem) => after(problem)}
                />
              ) : (
                <div className="skeleton tr-block-skeleton" aria-hidden="true" />
              )
            ) : !selected || lastFor !== selected ? (
              <div className="skeleton tr-block-skeleton" aria-hidden="true" />
            ) : (
              <>
                {shown ? (
                  <RunHeader
                    run={shown}
                    working={working}
                    onAnalyse={() => void drive(() => startAnalysis(selected))}
                    onContinue={() => void drive(() => Promise.resolve(shown))}
                  />
                ) : (
                  <AgentHero
                    coin={selected}
                    agent={agent}
                    working={working}
                    onAnalyse={() => void drive(() => startAnalysis(selected))}
                    onChip={setQuestion}
                  />
                )}
                {runError && (
                  <div className="alert tr-run-error" role="alert">
                    <span>
                      {runError} Check Settings for the AI cap and connection, then try again.{" "}
                      <a href="#/settings">Open Settings</a>
                    </span>
                    <button
                      className="btn btn-small"
                      type="button"
                      disabled={working}
                      onClick={() => void drive(() => startAnalysis(selected))}
                    >
                      Try again
                    </button>
                  </div>
                )}
                {shown && (
                  <TicketCard
                    run={shown}
                    busy={choosing || !term || !live}
                    alerts={shownAlerts ?? []}
                    onSetAlert={(w) => void setAlert(w)}
                    onUse={() => openTicket("used")}
                    onEdit={() => openTicket("edited")}
                    onDismiss={() => choose("dismissed")}
                  />
                )}
                {shown && <Timeline run={shown} working={working} />}
                {shown && <Asks run={shown} />}
              </>
            )}
          </div>
        </div>

        {view === "agent" && (
          <form className="tr-ask" onSubmit={ask}>
            <div className="tr-ask-in">
              <input
                aria-label={`Ask ${name}`}
                placeholder={
                  shown
                    ? `Ask ${name} about ${coin}…`
                    : `Analyse ${coin} first, then ask ${name} about the call`
                }
                value={question}
                maxLength={500}
                disabled={!canAsk}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button
                className="btn btn-small"
                type="submit"
                disabled={!canAsk || !question.trim()}
              >
                {asking ? "Asking…" : "Ask"}
              </button>
            </div>
            {askError && (
              <p className="error-text tr-ask-error" role="alert">
                {askError}
              </p>
            )}
          </form>
        )}
      </section>

      <aside className="tr-col tr-ctx" aria-label="Context">
        <PriceCard market={shownMarket} run={shown} symbol={term?.symbol ?? null} />
        <LevelsCard run={shown} now={shownMarket?.price ?? null} />
        <GuardrailsCard run={shown} />
        <AlertsCard
          coin={coin}
          alerts={shownAlerts}
          error={alertError}
          onRemove={(id) => void removeAlert(id)}
        />
      </aside>

      {sheet && term && live && (
        <OrderSheet
          key={sheet.n}
          start={sheet}
          terminal={term}
          settings={live}
          agentName={name}
          onClose={() => setSheet(null)}
          onPlaced={(note) => {
            after(undefined, note);
            const logged = sheet.choice;
            if (logged)
              chooseTicket(logged.runId, logged.choice).then(
                (next) => setRun((r) => (r?.id === next.id ? next : r)),
                (e: unknown) => setRunError(`Your choice wasn't logged: ${message(e)}`),
              );
          }}
          onSettings={onSettings}
          onSmartTrade={(side, at) => {
            setSmartPrefill((p) => ({ side, price: at, n: (p?.n ?? 0) + 1 }));
            setView("orders");
          }}
        />
      )}
    </main>
  );
}
