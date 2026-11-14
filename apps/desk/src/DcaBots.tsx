import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createBot,
  deleteBot,
  editBot,
  getBot,
  getBots,
  previewBot,
  suggestBot,
  switchBot,
} from "./api";
import { BotChart, CoinSelect, CreateMenu, RobotIcon, useWatchCoins, type Level } from "./BotKit";
import CoinIcon from "./CoinIcon";
import { dateTime, price } from "./format";
import type {
  DcaBot,
  DcaBots as Bots,
  DcaDetail,
  DcaPreview,
  DcaRequest,
  DealDetail,
} from "./types";

// The DCA Bot page: the owner's bots, a wizard that starts from a preset built on the coin's
// last 30 days, and each bot's deals. A bot is created off; switching it on is the confirm.

const REFRESH_MS = 30_000;
const PREVIEW_DELAY_MS = 400;
const STEPS = ["Coin", "Entry", "Orders", "Exit"] as const;

const two = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function quoteAmount(value: string | null, quote: string, signed = false): string {
  if (value === null) return "–";
  const n = Number(value);
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}${two.format(Math.abs(n))} ${quote}`;
}

export function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Try again.";
}

export const ORDER_STATUS: Record<string, string> = {
  open: "Waiting",
  filled: "Filled",
  cancelled: "Cancelled",
  wanted: "Queued",
  placing: "Sending",
};

type View =
  | { kind: "list" }
  | { kind: "new"; coin: string }
  | { kind: "edit"; bot: DcaBot }
  | { kind: "copy"; bot: DcaBot }
  | { kind: "bot"; id: number };

export default function DcaBots() {
  const [view, setView] = useState<Bots | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<View>({ kind: "list" });
  const [confirming, setConfirming] = useState<DcaBot | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const coins = useWatchCoins();

  const load = useCallback(() => {
    getBots().then(
      (next) => {
        setView(next);
        setError(null);
      },
      (e: unknown) => setError(message(e)),
    );
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const act = (work: Promise<Bots>, then?: () => void) => {
    setBusy(true);
    work.then(
      (next) => {
        setView(next);
        setError(null);
        setBusy(false);
        then?.();
      },
      (e: unknown) => {
        setError(message(e));
        setBusy(false);
      },
    );
  };

  const toggle = (bot: DcaBot) => {
    if (bot.enabled) {
      act(switchBot(bot.id, false));
      return;
    }
    setConfirming(bot);
    dialog.current?.showModal?.();
  };

  const switchOn = () => {
    if (!confirming) return;
    act(switchBot(confirming.id, true));
    dialog.current?.close?.();
    setConfirming(null);
  };

  const quote = view?.quote ?? "USDC";
  const bots = view?.bots ?? [];
  const create = (coin: string) => setPage({ kind: "new", coin });

  return (
    <main className="wrap dca-page">
      <div className="head-row">
        <h1 className="visually-hidden">DCA Bot</h1>
        {page.kind === "list" && <CreateMenu coins={coins} onPick={create} />}
      </div>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {view && !view.tradingOn && (
        <div className="alert notice" role="status">
          Trading is off, so bots stay stopped until you turn it on.
        </div>
      )}

      {(page.kind === "new" || page.kind === "edit" || page.kind === "copy") && (
        <BotWizard
          key={page.kind === "new" ? `new-${page.coin}` : `${page.kind}-${page.bot.id}`}
          quote={quote}
          coins={coins}
          coin={page.kind === "new" ? page.coin : page.bot.symbol.slice(0, -quote.length)}
          editing={page.kind === "edit" ? page.bot : null}
          copying={page.kind === "copy" ? page.bot : null}
          onCancel={() => setPage({ kind: "list" })}
          onSaved={(next) => {
            setView(next);
            setPage({ kind: "list" });
          }}
        />
      )}

      {page.kind === "bot" && (
        <BotDetail
          id={page.id}
          quote={quote}
          busy={busy}
          version={view}
          onBack={() => setPage({ kind: "list" })}
          onToggle={toggle}
          onEdit={(bot) => setPage({ kind: "edit", bot })}
          onCopy={(bot) => setPage({ kind: "copy", bot })}
          onDelete={(bot) => act(deleteBot(bot.id), () => setPage({ kind: "list" }))}
        />
      )}

      {page.kind === "list" && (
        <>
          {view === null && !error && <div className="skeleton" style={{ height: 160 }} />}
          {view && bots.length === 0 && (
            <div className="bot-empty">
              <RobotIcon />
              <b>No DCA bots yet</b>
              <p className="muted">
                Start a DCA strategy with regular purchases, price deviations and risk controls.
              </p>
              <CreateMenu coins={coins} onPick={create} />
            </div>
          )}
          {bots.length > 0 && (
            <BotTable
              bots={bots}
              quote={quote}
              busy={busy}
              onOpen={(bot) => setPage({ kind: "bot", id: bot.id })}
              onEdit={(bot) => setPage({ kind: "edit", bot })}
              onCopy={(bot) => setPage({ kind: "copy", bot })}
              onToggle={toggle}
              onDelete={(bot) => act(deleteBot(bot.id))}
            />
          )}
        </>
      )}

      <dialog ref={dialog} aria-labelledby="bot-confirm" onClose={() => setConfirming(null)}>
        {confirming && <SwitchOnText bot={confirming} quote={quote} />}
        <div className="dlg-btns">
          <button className="btn" type="button" onClick={() => dialog.current?.close?.()}>
            Cancel
          </button>
          <button className="btn btn-accent" type="button" onClick={switchOn}>
            Switch on
          </button>
        </div>
      </dialog>
    </main>
  );
}

function SwitchOnText({ bot, quote }: { bot: DcaBot; quote: string }) {
  const c = bot.config;
  const deals =
    c.maxDeals > 1
      ? ` Up to ${c.maxDeals} deals can run at once, ${quoteAmount(bot.maxBudget, quote)} in all.`
      : "";
  return (
    <>
      <h2 id="bot-confirm">Switch on {bot.name}?</h2>
      <p>
        When a {c.timeframe} candle closes below the lower Bollinger Band, it starts a deal: a base
        order and up to {c.maxDcaOrders} DCA orders,{" "}
        <b>
          {c.maxDcaOrders + 1} limit buys totalling up to {quoteAmount(bot.budget, quote)}
        </b>
        , then a limit sell {c.takeProfit}% over the average price. After each take profit it waits
        for the next signal.{deals}
      </p>
      <p>
        It places these <b>without asking you each time</b>, inside your per-order and daily limits.
        The kill switch stops it and cancels its open buys.
      </p>
    </>
  );
}

const STATUS: Record<DcaBot["status"], [string, string]> = {
  off: ["Off", ""],
  waiting: ["Waiting for signal", "wait"],
  deal: ["In a deal", "run"],
  finishing: ["Off · finishing its deals", "run"],
  paused: ["Paused", "down"],
};

function StatusPill({ bot }: { bot: DcaBot }) {
  const [label, tone] = STATUS[bot.status];
  const text =
    bot.status === "deal" && bot.config.maxDeals > 1
      ? `${bot.deals.length} of ${bot.config.maxDeals} deals`
      : label;
  return <span className={`pill dca-pill ${tone}`}>{text}</span>;
}

function since(ms: number | null): string {
  if (!ms) return "–";
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} days`;
}

function summary(bot: DcaBot): string[] {
  const c = bot.config;
  return [
    `Base ${c.baseOrder} · ${c.maxDcaOrders} DCA orders of ${c.dcaOrder}`,
    `${c.deviation}% deviation · ${c.sizeMultiplier}× size · ${c.deviationMultiplier}× step`,
    `${c.timeframe} below the band · take profit ${c.takeProfit}%`,
  ];
}

function running(bot: DcaBot): boolean {
  return bot.enabled || bot.deals.length > 0;
}

function BotTable({
  bots,
  quote,
  busy,
  onOpen,
  onEdit,
  onCopy,
  onToggle,
  onDelete,
}: {
  bots: DcaBot[];
  quote: string;
  busy: boolean;
  onOpen: (bot: DcaBot) => void;
  onEdit: (bot: DcaBot) => void;
  onCopy: (bot: DcaBot) => void;
  onToggle: (bot: DcaBot) => void;
  onDelete: (bot: DcaBot) => void;
}) {
  const [show, setShow] = useState<"active" | "stopped">(() =>
    bots.some(running) ? "active" : "stopped",
  );
  const shown = bots.filter((b) => running(b) === (show === "active"));
  return (
    <>
      <div className="seg bot-filter" role="group" aria-label="Show">
        {(["active", "stopped"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={show === k ? "on" : ""}
            aria-pressed={show === k}
            onClick={() => setShow(k)}
          >
            {k === "active" ? "Active" : "Stopped"}
          </button>
        ))}
      </div>
      <div className="card scroll">
        <table className="bot-table">
          <thead>
            <tr>
              <th scope="col">Bot</th>
              <th scope="col">Started · in trading</th>
              <th scope="col">DCA</th>
              <th scope="col" className="r">
                Budget · per deal
              </th>
              <th scope="col" className="r">
                Realised PnL · deals
              </th>
              <th scope="col" className="r">
                Unrealised PnL · deals
              </th>
              <th scope="col" className="r">
                Total PnL
              </th>
              <th scope="col" className="r">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="muted empty">
                  {show === "active" ? "No bot is running." : "No stopped bots."}
                </td>
              </tr>
            )}
            {shown.map((bot) => {
              const unrealised = bot.deals.reduce((s, d) => s + Number(d.unrealised ?? 0), 0);
              const total = unrealised + Number(bot.profit);
              const started = bot.deals[0]?.started ?? null;
              const idle = !bot.enabled && bot.deals.length === 0;
              return (
                <tr key={bot.id}>
                  <td>
                    <button type="button" className="coin card-open" onClick={() => onOpen(bot)}>
                      <CoinIcon coin={bot.symbol.slice(0, -quote.length)} />
                      <span>
                        <b>{bot.name}</b>
                        <span className="ref">{bot.ref}</span>
                        <StatusPill bot={bot} />
                      </span>
                    </button>
                  </td>
                  <td className="muted">
                    {started ? dateTime(started) : "–"}
                    <div>{bot.enabled ? since(started) : "Off"}</div>
                  </td>
                  <td className="bot-dca">
                    {summary(bot).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </td>
                  <td className="r num">
                    {quoteAmount(bot.maxBudget, quote)}
                    <div className="muted">{quoteAmount(bot.budget, quote)}</div>
                  </td>
                  <td className={`r num ${Number(bot.profit) > 0 ? "up" : ""}`}>
                    {quoteAmount(bot.profit, quote, true)}
                    <div className="muted">{bot.closed}</div>
                  </td>
                  <td className={`r num ${unrealised < 0 ? "down" : unrealised > 0 ? "up" : ""}`}>
                    {quoteAmount(String(unrealised), quote, true)}
                    <div className="muted">{bot.deals.length}</div>
                  </td>
                  <td className={`r num ${total < 0 ? "down" : total > 0 ? "up" : ""}`}>
                    {quoteAmount(String(total), quote, true)}
                  </td>
                  <td className="r">
                    <div className="row-actions">
                      <button type="button" className="btn btn-small" onClick={() => onOpen(bot)}>
                        Positions
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={!idle || busy}
                        onClick={() => onEdit(bot)}
                      >
                        Edit
                      </button>
                      <button type="button" className="btn btn-small" onClick={() => onCopy(bot)}>
                        Copy
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={busy}
                        onClick={() => onToggle(bot)}
                      >
                        {bot.enabled ? "Stop" : "Start"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={!idle || busy}
                        onClick={() => onDelete(bot)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BotDetail({
  id,
  quote,
  busy,
  version,
  onBack,
  onToggle,
  onEdit,
  onCopy,
  onDelete,
}: {
  id: number;
  quote: string;
  busy: boolean;
  version: Bots | null;
  onBack: () => void;
  onToggle: (bot: DcaBot) => void;
  onEdit: (bot: DcaBot) => void;
  onCopy: (bot: DcaBot) => void;
  onDelete: (bot: DcaBot) => void;
}) {
  const [detail, setDetail] = useState<DcaDetail | null>(null);
  const [chart, setChart] = useState<DcaPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "history">("live");
  useEffect(() => {
    getBot(id).then(
      (found) => {
        setDetail(found);
        previewBot({ ...found.bot.config, symbol: found.bot.symbol }).then(setChart, () =>
          setChart(null),
        );
      },
      (e: unknown) => setError(message(e)),
    );
  }, [id, version]);

  const levels = useMemo<Level[]>(() => {
    const found: Level[] = [];
    for (const deal of detail?.deals ?? []) {
      if (deal.status !== "open") continue;
      if (deal.average)
        found.push({ price: Number(deal.average), title: `${deal.ref} average`, tone: "muted" });
      if (deal.takeProfit)
        found.push({
          price: Number(deal.takeProfit),
          title: `${deal.ref} take profit`,
          tone: "tp",
        });
      for (const o of deal.orders) {
        if (o.side === "buy" && o.status === "open") {
          found.push({
            price: Number(o.price),
            title: o.kind,
            tone: o.kind === "Base order" ? "base" : "buy",
          });
        }
      }
    }
    if (found.length === 0 && chart) {
      found.push({ price: Number(chart.band.lower), title: "Entry below", tone: "base" });
    }
    return found;
  }, [detail, chart]);

  if (error) {
    return (
      <div className="alert" role="alert">
        {error}
      </div>
    );
  }
  if (!detail) return <div className="skeleton" style={{ height: 240 }} />;
  const bot = detail.bot;
  const c = bot.config;
  const live = detail.deals.filter((d) => d.status === "open");
  const history = detail.deals.filter((d) => d.status !== "open");
  const shown = tab === "live" ? live : history;
  const idle = !bot.enabled && live.length === 0;
  const unrealised = live.reduce((s, d) => s + Number(d.unrealised ?? 0), 0);
  const row = (label: string, value: string) => (
    <div className="kv" key={label}>
      <span className="muted">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
  return (
    <section className="bot-detail" aria-label={`${bot.name} details`}>
      <button type="button" className="link" onClick={onBack}>
        ← All DCA bots
      </button>
      <div className="dca-top detail-top">
        <span className="coin">
          <CoinIcon coin={bot.symbol.slice(0, -quote.length)} />
          <b>{bot.name}</b>
          <span className="ref">{bot.ref}</span>
        </span>
        <StatusPill bot={bot} />
        <span className="spacer" />
        <button
          className="btn btn-small"
          type="button"
          disabled={!idle || busy}
          onClick={() => onEdit(bot)}
        >
          Edit
        </button>
        <button className="btn btn-small" type="button" onClick={() => onCopy(bot)}>
          Copy
        </button>
        <button
          className="btn btn-small"
          type="button"
          disabled={busy}
          onClick={() => onToggle(bot)}
        >
          {bot.enabled ? "Stop" : "Start"}
        </button>
        <button
          className="btn btn-small"
          type="button"
          disabled={!idle || busy}
          onClick={() => onDelete(bot)}
        >
          Delete
        </button>
      </div>
      {bot.note && <p className="dca-note muted">{bot.note}</p>}
      <div className="detail-grid">
        <div className="card detail-settings">
          <h3>General</h3>
          {row("Status", STATUS[bot.status][0])}
          {row("ID", bot.ref)}
          {row("Pair", bot.pair)}
          {row("Budget per deal", quoteAmount(bot.budget, quote))}
          {row("Simultaneous deals", String(c.maxDeals))}
          {row("Started", live[0] ? dateTime(live[0].started) : "–")}
          <h3>Entry</h3>
          {row("Order type", "Limit")}
          {row(
            "Start condition",
            `${c.timeframe} close below Bollinger Band (${c.bbLength}, ${c.bbDeviation})`,
          )}
          {row("Base order", quoteAmount(c.baseOrder, quote))}
          {row("DCA order", quoteAmount(c.dcaOrder, quote))}
          {row("Max DCA orders", String(c.maxDcaOrders))}
          {row("Deviation", `${c.deviation}%`)}
          {row("DCA size multiplier", `${c.sizeMultiplier}×`)}
          {row("Deviation multiplier", `${c.deviationMultiplier}×`)}
          <h3>Exit</h3>
          {row("Take profit", `${c.takeProfit}%`)}
          {row("Based on", "Average price")}
          {row("Order type", "Limit")}
        </div>
        <div>
          {chart ? (
            <BotChart
              candles={chart.chart}
              bands={chart.chart}
              levels={levels}
              height={380}
              label={`${bot.pair} ${c.timeframe} candles with this bot's orders`}
            />
          ) : (
            <div className="skeleton" style={{ height: 380 }} />
          )}
          <div className="dca-tiles">
            <div>
              <span className="label">Realised PnL</span>
              <b className={`num ${Number(bot.profit) > 0 ? "up" : ""}`}>
                {quoteAmount(bot.profit, quote, true)}
              </b>
            </div>
            <div>
              <span className="label">Unrealised PnL</span>
              <b className={`num ${unrealised < 0 ? "down" : unrealised > 0 ? "up" : ""}`}>
                {quoteAmount(String(unrealised), quote, true)}
              </b>
            </div>
            <div>
              <span className="label">Realised deals</span>
              <b className="num">{bot.closed}</b>
            </div>
            <div>
              <span className="label">Live deals</span>
              <b className="num">
                {live.length} of {c.maxDeals}
              </b>
            </div>
          </div>
        </div>
      </div>
      <h2 className="positions-title">Positions</h2>
      <div className="seg bot-filter" role="tablist" aria-label="Positions">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "live"}
          className={tab === "live" ? "on" : ""}
          onClick={() => setTab("live")}
        >
          Live ({live.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={tab === "history" ? "on" : ""}
          onClick={() => setTab("history")}
        >
          History ({history.length})
        </button>
      </div>
      {shown.length === 0 && (
        <p className="muted empty">
          {tab === "live" ? "No live positions." : "No closed positions yet."}
        </p>
      )}
      {shown.map((deal) => (
        <DealCard key={deal.id} deal={deal} quote={quote} />
      ))}
    </section>
  );
}

const DEAL_STATUS: Record<DealDetail["status"], string> = {
  open: "Running",
  closed: "Closed at take profit",
  expired: "Expired: the base order didn't fill",
  stopped: "Stopped",
};

export function DealCard({ deal, quote }: { deal: DealDetail; quote: string }) {
  const open = deal.status === "open";
  return (
    <details className="card deal-card" open={open}>
      <summary>
        <span className="ref">{deal.ref}</span>
        <span className="muted">{DEAL_STATUS[deal.status]}</span>
        <span className="muted">{dateTime(deal.started)}</span>
        <span className="spacer" />
        {open ? (
          <span className={`num ${Number(deal.unrealised ?? 0) < 0 ? "down" : "up"}`}>
            {quoteAmount(deal.unrealised ?? null, quote, true)}
          </span>
        ) : (
          <span className={`num ${Number(deal.profit ?? 0) > 0 ? "up" : ""}`}>
            {deal.profit ? quoteAmount(deal.profit, quote, true) : "–"}
          </span>
        )}
      </summary>
      {open && (
        <div className="deal-facts">
          <span>
            Spent <b className="num">{quoteAmount(deal.spent ?? "0", quote)}</b>
          </span>
          <span>
            Average <b className="num">{price(deal.average ?? null)}</b>
          </span>
          <span>
            Take profit <b className="num up">{price(deal.takeProfit ?? null)}</b>
          </span>
          <span>
            DCA filled{" "}
            <b className="num">
              {deal.filled ?? 0} of {deal.of ?? 0}
            </b>
          </span>
        </div>
      )}
      {deal.note && <p className="dca-note muted">{deal.note}</p>}
      <div className="scroll">
        <table className="dca-ladder">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Type</th>
              <th scope="col" className="r">
                Price
              </th>
              <th scope="col" className="r">
                Amount
              </th>
              <th scope="col" className="r">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {deal.orders.map((o) => (
              <tr key={o.ref}>
                <td className="ref-cell">{o.ref}</td>
                <td className={o.side === "sell" ? "up" : ""}>{o.kind}</td>
                <td className="r num">{price(o.price)}</td>
                <td className="r num">{o.qty}</td>
                <td className="r muted">{ORDER_STATUS[o.status] ?? o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function fromBot(bot: DcaBot | null, coin: string, quote: string): DcaRequest {
  if (bot) return { ...bot.config, symbol: bot.symbol };
  return {
    symbol: `${coin}${quote}`,
    timeframe: "1h",
    bbLength: 20,
    bbDeviation: "2",
    baseOrder: "25",
    dcaOrder: "20",
    deviation: "2",
    maxDcaOrders: 5,
    sizeMultiplier: "1",
    deviationMultiplier: "1",
    takeProfit: "1.5",
    maxDeals: 1,
  };
}

function BotWizard({
  quote,
  coins,
  coin: startCoin,
  editing,
  copying,
  onCancel,
  onSaved,
}: {
  quote: string;
  coins: string[] | null;
  coin: string;
  editing: DcaBot | null;
  copying: DcaBot | null;
  onCancel: () => void;
  onSaved: (next: Bots) => void;
}) {
  const [form, setForm] = useState<DcaRequest>(() => fromBot(editing ?? copying, startCoin, quote));
  const [step, setStep] = useState(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [presetting, setPresetting] = useState(!editing && !copying);
  const [preview, setPreview] = useState<DcaPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const coin = form.symbol.slice(0, -quote.length);

  const preset = useCallback((symbol: string) => {
    setPresetting(true);
    suggestBot(symbol).then(
      (found) => {
        setForm({ ...found.config, symbol });
        setReasons(found.reasons);
        setPresetting(false);
      },
      (e: unknown) => {
        setPreviewError(message(e));
        setPresetting(false);
      },
    );
  }, []);

  useEffect(() => {
    if (editing ?? copying) return;
    let live = true;
    const symbol = `${startCoin}${quote}`;
    suggestBot(symbol).then(
      (found) => {
        if (!live) return;
        setForm({ ...found.config, symbol });
        setReasons(found.reasons);
        setPresetting(false);
      },
      (e: unknown) => {
        if (!live) return;
        setPreviewError(message(e));
        setPresetting(false);
      },
    );
    return () => {
      live = false;
    };
  }, [editing, copying, startCoin, quote]);

  useEffect(() => {
    if (presetting) return;
    const timer = setTimeout(() => {
      previewBot(form).then(
        (next) => {
          setPreview(next);
          setPreviewError(null);
        },
        (e: unknown) => setPreviewError(message(e)),
      );
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form, presetting]);

  const set = <K extends keyof DcaRequest>(key: K, value: DcaRequest[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setReasons((r) => ({ ...r, [key]: "" }));
  };

  const save = () => {
    setSaving(true);
    (editing ? editBot(editing.id, form) : createBot(form)).then(onSaved, (e: unknown) => {
      setSaveError(message(e));
      setSaving(false);
    });
  };

  const why = (key: string) =>
    reasons[key] ? <div className="dca-reason">{reasons[key]}</div> : null;

  const field = (id: keyof DcaRequest, label: string, unit: string | null) => (
    <div className="field">
      <label htmlFor={`dca-${id}`}>{label}</label>
      <div className="in">
        <input
          id={`dca-${id}`}
          className="num"
          inputMode="decimal"
          value={String(form[id])}
          onChange={(e) => set(id, e.target.value as never)}
        />
        {unit && <span className="muted">{unit}</span>}
      </div>
      {why(id)}
    </div>
  );

  const choice = <K extends "timeframe" | "maxDeals">(
    key: K,
    label: string,
    options: [DcaRequest[K], string][],
  ) => (
    <div className="field">
      <span className="dca-label">{label}</span>
      <div className="seg dca-seg" role="group" aria-label={label}>
        {options.map(([value, text]) => (
          <button
            key={text}
            type="button"
            className={form[key] === value ? "on" : ""}
            aria-pressed={form[key] === value}
            onClick={() => set(key, value)}
          >
            {text}
          </button>
        ))}
      </div>
      {why(key)}
    </div>
  );

  return (
    <div className="dca-layout">
      <section
        className="card dca-wizard"
        aria-label={editing ? `Edit ${editing.name}` : "New DCA bot"}
      >
        <h2 className="wizard-title">
          <CoinIcon coin={coin} />
          {coin}/{quote}
          {editing && <span className="ref">{editing.ref}</span>}
        </h2>
        <ol className="dca-steps">
          {STEPS.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                className={i === step ? "on" : i < step ? "done" : ""}
                aria-current={i === step ? "step" : undefined}
                onClick={() => setStep(i)}
              >
                {i + 1} {name}
              </button>
            </li>
          ))}
        </ol>
        {presetting && (
          <p className="dca-cond muted" role="status">
            Building a preset for {coin} from its last 30 days…
          </p>
        )}

        {step === 0 && (
          <div>
            <div className="field">
              <label htmlFor="dca-coin">Coin</label>
              <CoinSelect
                id="dca-coin"
                coins={coins}
                value={coin}
                onChange={(next) => {
                  setForm((f) => ({ ...f, symbol: `${next}${quote}` }));
                  preset(`${next}${quote}`);
                }}
              />
              <div className="dca-reason">From your watchlist, traded against {quote}</div>
            </div>
            {!presetting && Object.keys(reasons).length > 0 && (
              <p className="dca-cond">
                Every setting is filled from what did best for {coin} over the last 30 days. Each
                one says why, and you can change any of them.
              </p>
            )}
            {(editing ?? copying) && (
              <button type="button" className="btn btn-small" onClick={() => preset(form.symbol)}>
                Use the 30-day preset
              </button>
            )}
          </div>
        )}

        {step === 1 && (
          <div>
            <p className="dca-cond">
              Start a deal when a <b>{form.timeframe}</b> candle closes{" "}
              <b>below the lower Bollinger Band</b>.
            </p>
            {choice("timeframe", "Timeframe", [
              ["15m", "15m"],
              ["1h", "1h"],
              ["4h", "4h"],
            ])}
            <div className="dca-two">
              {field("bbLength", "Band length", "candles")}
              {field("bbDeviation", "Band width", "×")}
            </div>
            {preview && (
              <div className={`dca-now ${preview.met ? "up" : "wait"}`}>
                Now {price(preview.price)} · lower band {price(preview.band.lower)} ·{" "}
                {preview.met ? "a deal would start" : "waiting for a dip"}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="dca-two">
            {field("baseOrder", "Base order", quote)}
            {field("dcaOrder", "DCA order", quote)}
            {field("deviation", "Deviation", "%")}
            {field("maxDcaOrders", "Max DCA orders", null)}
            {field("sizeMultiplier", "DCA size multiplier", "×")}
            {field("deviationMultiplier", "Deviation multiplier", "×")}
          </div>
        )}

        {step === 3 && (
          <div>
            {field("takeProfit", "Take profit", "%")}
            {choice("maxDeals", "Simultaneous deals", [
              [1, "1"],
              [2, "2"],
              [3, "3"],
              [4, "4"],
              [5, "5"],
            ])}
            <p className="dca-cond muted">
              After each take profit the bot waits, and starts a new deal when the entry condition
              is met again.
            </p>
          </div>
        )}

        {saveError && (
          <div className="alert" role="alert">
            {saveError}
          </div>
        )}
        <div className="dca-nav">
          <button className="btn" type="button" onClick={step ? () => setStep(step - 1) : onCancel}>
            {step ? "Back" : "Cancel"}
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn btn-accent" type="button" onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button
              className="btn btn-accent"
              type="button"
              disabled={saving || presetting || previewError !== null}
              onClick={save}
            >
              {editing ? "Save changes" : "Create bot"}
            </button>
          )}
        </div>
      </section>

      <Preview preview={preview} error={previewError} form={form} />
    </div>
  );
}

function Preview({
  preview,
  error,
  form,
}: {
  preview: DcaPreview | null;
  error: string | null;
  form: DcaRequest;
}) {
  const levels = useMemo<Level[]>(() => {
    if (!preview) return [];
    const ladder = preview.ladder.map<Level>((r) => ({
      price: Number(r.price),
      title: r.rung ? `DCA ${r.rung}` : "Base",
      tone: r.rung ? "buy" : "base",
    }));
    const first = preview.ladder[0];
    return first
      ? [...ladder, { price: Number(first.takeProfit), title: "Take profit", tone: "tp" }]
      : ladder;
  }, [preview]);

  if (error) {
    return (
      <section className="card dca-preview" aria-label="Ladder">
        <div className="alert" role="alert">
          {error}
        </div>
      </section>
    );
  }
  if (!preview) {
    return (
      <section className="card dca-preview" aria-label="Ladder">
        <div className="skeleton" style={{ height: 320 }} />
      </section>
    );
  }
  const q = preview.quote;
  const s = preview.settings;
  const short = Number(preview.available) < Number(preview.budget);
  const b = preview.backtest;
  const days = b.from && b.to ? Math.round((b.to - b.from) / 86_400_000) : 0;
  return (
    <section className="card dca-preview" aria-label="Ladder">
      <div className="dca-tiles">
        <div>
          <span className="label">Budget per deal</span>
          <b className="num">{quoteAmount(preview.budget, q)}</b>
        </div>
        <div>
          <span className="label">Covers a drop of</span>
          <b className="num">{Number(preview.covers).toFixed(1)}%</b>
        </div>
        <div>
          <span className="label">Available</span>
          <b className={`num ${short ? "down" : ""}`}>{quoteAmount(preview.available, q)}</b>
        </div>
        <div>
          <span className="label">Your limits</span>
          <b className={`num ${preview.problems.length ? "down" : "up"}`}>
            {preview.problems.length ? "Check below" : `OK · ${quoteAmount(s.perOrder, q)} each`}
          </b>
        </div>
      </div>
      {preview.problems.length > 0 && (
        <ul className="dca-problems">
          {preview.problems.map((p) => (
            <li key={p} className="wait">
              {p}
            </li>
          ))}
        </ul>
      )}
      <BotChart
        candles={preview.chart}
        bands={preview.chart}
        levels={levels}
        label={`${preview.pair} ${form.timeframe} candles with the Bollinger Band and where each order would sit`}
      />
      <div className="scroll">
        <table className="dca-ladder">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col" className="r">
                Drop
              </th>
              <th scope="col" className="r">
                Limit price
              </th>
              <th scope="col" className="r">
                Size
              </th>
              <th scope="col" className="r">
                Total
              </th>
              <th scope="col" className="r">
                Average
              </th>
              <th scope="col" className="r">
                Take profit at
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.ladder.map((r) => (
              <tr key={r.rung}>
                <td>{r.rung ? `DCA ${r.rung}` : "Base"}</td>
                <td className="r num">{Number(r.drop).toFixed(1)}%</td>
                <td className="r num">{price(r.price)}</td>
                <td className="r num">{two.format(Number(r.spend))}</td>
                <td className="r num">{two.format(Number(r.total))}</td>
                <td className="r num">{price(r.average)}</td>
                <td className="r num up">{price(r.takeProfit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dca-backtest" aria-label="Backtest">
        <div className="kv" style={{ padding: 0 }}>
          <span className="label">Backtest</span>
          <span className="label muted">
            last {days} days of {form.timeframe} candles, fees included
          </span>
        </div>
        <div className="dca-tiles">
          <div>
            <span className="label">Deals closed</span>
            <b className="num">{b.deals}</b>
          </div>
          <div>
            <span className="label">Profit</span>
            <b
              className={`num ${Number(b.profit) > 0 ? "up" : Number(b.profit) < 0 ? "down" : ""}`}
            >
              {quoteAmount(b.profit, q, true)}
            </b>
            <small className="muted">{b.profitPercent}% of budget</small>
          </div>
          <div>
            <span className="label">Deepest DCA used</span>
            <b className="num">
              {b.mostDcaFilled} of {form.maxDcaOrders}
            </b>
          </div>
          <div>
            <span className="label">Worst drawdown</span>
            <b className={`num ${Number(b.worstDrawdown) < 0 ? "down" : ""}`}>{b.worstDrawdown}%</b>
          </div>
        </div>
        <div className="dca-hint">
          {b.averageHours !== null && `A deal took ${b.averageHours} hours on average. `}
          {b.openDeal && `A deal is still open, at ${quoteAmount(b.unrealised, q, true)}. `}
          Past results don&apos;t promise future ones.
        </div>
      </div>
    </section>
  );
}
