import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createGrid,
  deleteGrid,
  editGrid,
  getGrid,
  getGrids,
  previewGrid,
  suggestGrid,
  switchGrid,
} from "./api";
import { BotChart, CoinSelect, CreateMenu, RobotIcon, useWatchCoins, type Level } from "./BotKit";
import CoinIcon from "./CoinIcon";
import { ORDER_STATUS, message, quoteAmount } from "./DcaBots";
import { dateTime, price } from "./format";
import type { GridBot, GridBots as Grids, GridDetail, GridPreview, GridRequest } from "./types";

// The Grid Bot page: the owner's grids, a wizard that starts from a preset built on the coin's
// last 30 days, and each grid's orders. A grid is created off; switching it on is the confirm.

const REFRESH_MS = 30_000;
const PREVIEW_DELAY_MS = 400;
const STEPS = ["Coin", "Range", "Investment"] as const;

function fromGrid(grid: GridBot | null, coin: string, quote: string): GridRequest {
  if (!grid) {
    return {
      symbol: `${coin}${quote}`,
      lower: "",
      upper: "",
      grids: "10",
      spacing: "geometric",
      investment: "200",
      buyFirst: true,
      stopBelow: "",
    };
  }
  const c = grid.config;
  return {
    symbol: grid.symbol,
    lower: c.lower,
    upper: c.upper,
    grids: String(c.grids),
    spacing: c.spacing,
    investment: c.investment,
    buyFirst: c.buyFirst,
    stopBelow: c.stopBelow ?? "",
  };
}

type View =
  | { kind: "list" }
  | { kind: "new"; coin: string }
  | { kind: "edit"; grid: GridBot }
  | { kind: "copy"; grid: GridBot }
  | { kind: "grid"; id: number };

export default function GridBots() {
  const [view, setView] = useState<Grids | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<View>({ kind: "list" });
  const [confirming, setConfirming] = useState<GridBot | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const coins = useWatchCoins();

  const load = useCallback(() => {
    getGrids().then(
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

  const act = (work: Promise<Grids>, then?: () => void) => {
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

  const toggle = (grid: GridBot) => {
    // Off but with orders still out (after a pause or the kill switch): Stop cancels them.
    if (grid.enabled || grid.status === "finishing") {
      act(switchGrid(grid.id, false));
      return;
    }
    setConfirming(grid);
    dialog.current?.showModal?.();
  };

  const switchOn = () => {
    if (!confirming) return;
    act(switchGrid(confirming.id, true));
    dialog.current?.close?.();
    setConfirming(null);
  };

  const quote = view?.quote ?? "USDC";
  const grids = view?.grids ?? [];
  const create = (coin: string) => setPage({ kind: "new", coin });

  return (
    <main className="wrap dca-page">
      <div className="head-row">
        <h1 className="visually-hidden">Grid Bot</h1>
        {page.kind === "list" && <CreateMenu coins={coins} onPick={create} />}
      </div>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {view && !view.tradingOn && (
        <div className="alert notice" role="status">
          Trading is off, so grids stay stopped until you turn it on.
        </div>
      )}

      {(page.kind === "new" || page.kind === "edit" || page.kind === "copy") && (
        <GridWizard
          key={page.kind === "new" ? `new-${page.coin}` : `${page.kind}-${page.grid.id}`}
          quote={quote}
          coins={coins}
          coin={page.kind === "new" ? page.coin : page.grid.symbol.slice(0, -quote.length)}
          editing={page.kind === "edit" ? page.grid : null}
          copying={page.kind === "copy" ? page.grid : null}
          onCancel={() => setPage({ kind: "list" })}
          onSaved={(next) => {
            setView(next);
            setPage({ kind: "list" });
          }}
        />
      )}

      {page.kind === "grid" && (
        <GridPage
          id={page.id}
          quote={quote}
          busy={busy}
          version={view}
          onBack={() => setPage({ kind: "list" })}
          onToggle={toggle}
          onEdit={(grid) => setPage({ kind: "edit", grid })}
          onCopy={(grid) => setPage({ kind: "copy", grid })}
          onDelete={(grid) => act(deleteGrid(grid.id), () => setPage({ kind: "list" }))}
        />
      )}

      {page.kind === "list" && (
        <>
          {view === null && !error && <div className="skeleton" style={{ height: 160 }} />}
          {view && grids.length === 0 && (
            <div className="bot-empty">
              <RobotIcon />
              <b>No grid bots yet</b>
              <p className="muted">
                Buy low and sell high automatically while the price moves inside a range.
              </p>
              <CreateMenu coins={coins} onPick={create} />
            </div>
          )}
          {grids.length > 0 && (
            <GridTable
              grids={grids}
              quote={quote}
              busy={busy}
              onOpen={(grid) => setPage({ kind: "grid", id: grid.id })}
              onEdit={(grid) => setPage({ kind: "edit", grid })}
              onCopy={(grid) => setPage({ kind: "copy", grid })}
              onToggle={toggle}
              onDelete={(grid) => act(deleteGrid(grid.id))}
            />
          )}
        </>
      )}

      <dialog ref={dialog} aria-labelledby="grid-confirm" onClose={() => setConfirming(null)}>
        {confirming && <SwitchOnText grid={confirming} quote={quote} />}
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

function SwitchOnText({ grid, quote }: { grid: GridBot; quote: string }) {
  const c = grid.config;
  return (
    <>
      <h2 id="grid-confirm">Switch on {grid.name}?</h2>
      <p>
        It splits {price(c.lower)} to {price(c.upper)} into {c.grids} grids and places{" "}
        <b>limit orders of about {quoteAmount(c.perOrder, quote)} each</b>, up to{" "}
        <b>{quoteAmount(c.investment, quote)}</b> in all
        {c.buyFirst ? ", buying at today's price for the sells above it" : ""}. Each fill places the
        opposite order one line away, again and again
        {c.stopBelow ? `, until the price falls under ${price(c.stopBelow)}` : ""}.
      </p>
      <p>
        It places these <b>without asking you each time</b>, inside your per-order and daily limits.
        Stopping it cancels its orders; the kill switch cancels its buys.
      </p>
    </>
  );
}

const STATUS: Record<GridBot["status"], [string, string]> = {
  off: ["Off", ""],
  running: ["Running", "run"],
  finishing: ["Off · sells still open", "wait"],
  paused: ["Paused", "down"],
};

function StatusPill({ grid }: { grid: GridBot }) {
  const [label, tone] = STATUS[grid.status];
  return (
    <span className={`pill dca-pill ${tone}`}>
      {grid.status === "running" && !grid.inRange ? "Out of range" : label}
    </span>
  );
}

function GridTable({
  grids,
  quote,
  busy,
  onOpen,
  onEdit,
  onCopy,
  onToggle,
  onDelete,
}: {
  grids: GridBot[];
  quote: string;
  busy: boolean;
  onOpen: (grid: GridBot) => void;
  onEdit: (grid: GridBot) => void;
  onCopy: (grid: GridBot) => void;
  onToggle: (grid: GridBot) => void;
  onDelete: (grid: GridBot) => void;
}) {
  const running = (g: GridBot) => g.status === "running" || g.status === "finishing";
  const [show, setShow] = useState<"active" | "stopped">(() =>
    grids.some(running) ? "active" : "stopped",
  );
  const shown = grids.filter((g) => running(g) === (show === "active"));
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
              <th scope="col">Started</th>
              <th scope="col">Grid</th>
              <th scope="col" className="r">
                Investment · per order
              </th>
              <th scope="col" className="r">
                Grid profit · round trips
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
                <td colSpan={7} className="muted empty">
                  {show === "active" ? "No grid is running." : "No stopped grids."}
                </td>
              </tr>
            )}
            {shown.map((grid) => {
              const c = grid.config;
              const total = Number(grid.gridProfit) + Number(grid.unrealised ?? 0);
              const idle = grid.status === "off" || grid.status === "paused";
              return (
                <tr key={grid.id}>
                  <td>
                    <button type="button" className="coin card-open" onClick={() => onOpen(grid)}>
                      <CoinIcon coin={grid.symbol.slice(0, -quote.length)} />
                      <span>
                        <b>{grid.name}</b>
                        <span className="ref">{grid.ref}</span>
                        <StatusPill grid={grid} />
                      </span>
                    </button>
                  </td>
                  <td className="muted">{grid.started ? dateTime(grid.started) : "–"}</td>
                  <td className="bot-dca">
                    <div>
                      {price(c.lower)} – {price(c.upper)}
                    </div>
                    <div>
                      {c.grids} {c.spacing} grids · {c.profitPerGrid[0]}% each
                    </div>
                    <div>
                      {grid.openBuys} buys · {grid.openSells} sells open
                    </div>
                  </td>
                  <td className="r num">
                    {quoteAmount(c.investment, quote)}
                    <div className="muted">{quoteAmount(c.perOrder, quote)}</div>
                  </td>
                  <td className={`r num ${Number(grid.gridProfit) > 0 ? "up" : ""}`}>
                    {quoteAmount(grid.gridProfit, quote, true)}
                    <div className="muted">{grid.trips}</div>
                  </td>
                  <td className={`r num ${total < 0 ? "down" : total > 0 ? "up" : ""}`}>
                    {quoteAmount(String(total), quote, true)}
                  </td>
                  <td className="r">
                    <div className="row-actions">
                      <button type="button" className="btn btn-small" onClick={() => onOpen(grid)}>
                        Orders
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={!idle || busy}
                        onClick={() => onEdit(grid)}
                      >
                        Edit
                      </button>
                      <button type="button" className="btn btn-small" onClick={() => onCopy(grid)}>
                        Copy
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={busy}
                        onClick={() => onToggle(grid)}
                      >
                        {grid.enabled || grid.status === "finishing" ? "Stop" : "Start"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={!idle || busy}
                        onClick={() => onDelete(grid)}
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

function GridPage({
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
  version: Grids | null;
  onBack: () => void;
  onToggle: (grid: GridBot) => void;
  onEdit: (grid: GridBot) => void;
  onCopy: (grid: GridBot) => void;
  onDelete: (grid: GridBot) => void;
}) {
  const [detail, setDetail] = useState<GridDetail | null>(null);
  const [chart, setChart] = useState<GridPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "history">("live");
  useEffect(() => {
    getGrid(id).then(
      (found) => {
        setDetail(found);
        previewGrid({ ...fromGrid(found.grid, "", quote) }).then(setChart, () => setChart(null));
      },
      (e: unknown) => setError(message(e)),
    );
  }, [id, version, quote]);

  const levels = useMemo<Level[]>(
    () =>
      (detail?.orders ?? [])
        .filter((o) => o.status === "open")
        .map((o) => ({
          price: Number(o.price),
          title: o.side === "buy" ? "Buy" : "Sell",
          tone: o.side === "buy" ? ("buy" as const) : ("sell" as const),
        })),
    [detail],
  );

  if (error) {
    return (
      <div className="alert" role="alert">
        {error}
      </div>
    );
  }
  if (!detail) return <div className="skeleton" style={{ height: 240 }} />;
  const grid = detail.grid;
  const c = grid.config;
  const live = detail.orders.filter((o) => o.status === "open" || o.status === "wanted");
  const history = detail.orders.filter((o) => o.status === "filled" || o.status === "cancelled");
  const shown = tab === "live" ? live : history;
  const idle = grid.status === "off" || grid.status === "paused";
  const row = (label: string, value: string) => (
    <div className="kv" key={label}>
      <span className="muted">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
  return (
    <section className="bot-detail" aria-label={`${grid.name} details`}>
      <button type="button" className="link" onClick={onBack}>
        ← All grid bots
      </button>
      <div className="dca-top detail-top">
        <span className="coin">
          <CoinIcon coin={grid.symbol.slice(0, -quote.length)} />
          <b>{grid.name}</b>
          <span className="ref">{grid.ref}</span>
        </span>
        <StatusPill grid={grid} />
        <span className="spacer" />
        <button
          className="btn btn-small"
          type="button"
          disabled={!idle || busy}
          onClick={() => onEdit(grid)}
        >
          Edit
        </button>
        <button className="btn btn-small" type="button" onClick={() => onCopy(grid)}>
          Copy
        </button>
        <button
          className="btn btn-small"
          type="button"
          disabled={busy}
          onClick={() => onToggle(grid)}
        >
          {grid.enabled || grid.status === "finishing" ? "Stop" : "Start"}
        </button>
        <button
          className="btn btn-small"
          type="button"
          disabled={!idle || busy}
          onClick={() => onDelete(grid)}
        >
          Delete
        </button>
      </div>
      {grid.note && <p className="dca-note muted">{grid.note}</p>}
      <div className="detail-grid">
        <div className="card detail-settings">
          <h3>General</h3>
          {row("Status", STATUS[grid.status][0])}
          {row("ID", grid.ref)}
          {row("Pair", grid.pair)}
          {row("Started", grid.started ? dateTime(grid.started) : "–")}
          {row("Price now", price(grid.price))}
          <h3>Grid</h3>
          {row("Range", `${price(c.lower)} – ${price(c.upper)}`)}
          {row("Grids", `${c.grids} ${c.spacing}`)}
          {row(
            "Profit per grid",
            c.profitPerGrid[0] === c.profitPerGrid[1]
              ? `${c.profitPerGrid[0]}%`
              : `${c.profitPerGrid[0]}–${c.profitPerGrid[1]}%`,
          )}
          {row("Order type", "Limit")}
          <h3>Investment</h3>
          {row("Investment", quoteAmount(c.investment, quote))}
          {row("Per order", quoteAmount(c.perOrder, quote))}
          {row("Buy first", c.buyFirst ? "Yes" : "No")}
          {row("Stop below", c.stopBelow ? price(c.stopBelow) : "None")}
        </div>
        <div>
          {chart ? (
            <BotChart
              candles={chart.chart}
              levels={levels.length ? levels : linesOf(chart)}
              height={380}
              label={`${grid.pair} hourly candles with this grid's orders`}
            />
          ) : (
            <div className="skeleton" style={{ height: 380 }} />
          )}
          <div className="dca-tiles">
            <div>
              <span className="label">Grid profit</span>
              <b className={`num ${Number(grid.gridProfit) > 0 ? "up" : ""}`}>
                {quoteAmount(grid.gridProfit, quote, true)}
              </b>
            </div>
            <div>
              <span className="label">Coins held, at today&apos;s price</span>
              <b className={`num ${Number(grid.unrealised ?? 0) < 0 ? "down" : ""}`}>
                {quoteAmount(grid.unrealised, quote, true)}
              </b>
            </div>
            <div>
              <span className="label">Round trips</span>
              <b className="num">{grid.trips}</b>
            </div>
            <div>
              <span className="label">Open orders</span>
              <b className="num">
                {grid.openBuys} buys · {grid.openSells} sells
              </b>
            </div>
          </div>
        </div>
      </div>
      <h2 className="positions-title">Orders</h2>
      <div className="seg bot-filter" role="tablist" aria-label="Orders">
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
      {shown.length === 0 ? (
        <p className="muted empty">
          {tab === "live" ? "No live orders." : "No filled orders yet."}
        </p>
      ) : (
        <div className="card scroll">
          <table className="dca-ladder">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Side</th>
                <th scope="col" className="r">
                  Price
                </th>
                <th scope="col" className="r">
                  Amount
                </th>
                <th scope="col" className="r">
                  Profit
                </th>
                <th scope="col" className="r">
                  Status
                </th>
                <th scope="col" className="r">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.ref}>
                  <td className="ref-cell">{o.ref}</td>
                  <td className={o.side === "buy" ? "up" : "down"}>
                    {o.side === "buy" ? "Buy" : "Sell"}
                  </td>
                  <td className="r num">{price(o.price)}</td>
                  <td className="r num">{o.qty}</td>
                  <td className={`r num ${Number(o.profit ?? 0) > 0 ? "up" : ""}`}>
                    {o.profit ? quoteAmount(o.profit, quote, true) : "–"}
                  </td>
                  <td className="r muted">{ORDER_STATUS[o.status] ?? o.status}</td>
                  <td className="r muted">{dateTime(o.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function linesOf(preview: GridPreview): Level[] {
  const last = preview.lines.length - 1;
  return preview.lines.map((l, i) => ({
    price: Number(l.price),
    title:
      i === 0
        ? "Low"
        : i === last
          ? "High"
          : l.side === "buy"
            ? "Buy"
            : l.side === "sell"
              ? "Sell"
              : "",
    tone: l.side === "buy" ? "buy" : l.side === "sell" ? "sell" : "muted",
  }));
}

function GridWizard({
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
  editing: GridBot | null;
  copying: GridBot | null;
  onCancel: () => void;
  onSaved: (next: Grids) => void;
}) {
  const [form, setForm] = useState<GridRequest>(() =>
    fromGrid(editing ?? copying, startCoin, quote),
  );
  const [step, setStep] = useState(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [presetting, setPresetting] = useState(!editing && !copying);
  const [preview, setPreview] = useState<GridPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const coin = form.symbol.slice(0, -quote.length);

  const apply = (symbol: string, found: Awaited<ReturnType<typeof suggestGrid>>) => {
    const c = found.config;
    setForm({
      symbol,
      lower: c.lower,
      upper: c.upper,
      grids: String(c.grids),
      spacing: c.spacing,
      investment: c.investment,
      buyFirst: c.buyFirst,
      stopBelow: c.stopBelow ?? "",
    });
    setReasons(found.reasons);
    setPresetting(false);
  };

  const preset = (symbol: string) => {
    setPresetting(true);
    suggestGrid(symbol).then(
      (found) => apply(symbol, found),
      (e: unknown) => {
        setPreviewError(message(e));
        setPresetting(false);
      },
    );
  };

  useEffect(() => {
    if (editing ?? copying) return;
    let live = true;
    const symbol = `${startCoin}${quote}`;
    suggestGrid(symbol).then(
      (found) => {
        if (!live) return;
        const c = found.config;
        setForm({
          symbol,
          lower: c.lower,
          upper: c.upper,
          grids: String(c.grids),
          spacing: c.spacing,
          investment: c.investment,
          buyFirst: c.buyFirst,
          stopBelow: c.stopBelow ?? "",
        });
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
      previewGrid(form).then(
        (next) => {
          setPreview(next);
          setPreviewError(null);
        },
        (e: unknown) => setPreviewError(message(e)),
      );
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form, presetting]);

  const set = <K extends keyof GridRequest>(key: K, value: GridRequest[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setReasons((r) => ({ ...r, [key]: "" }));
  };

  const save = () => {
    setSaving(true);
    (editing ? editGrid(editing.id, form) : createGrid(form)).then(onSaved, (e: unknown) => {
      setSaveError(message(e));
      setSaving(false);
    });
  };

  const why = (key: string) =>
    reasons[key] ? <div className="dca-reason">{reasons[key]}</div> : null;

  const field = (
    id: "lower" | "upper" | "grids" | "investment" | "stopBelow",
    label: string,
    unit: string | null,
  ) => (
    <div className="field">
      <label htmlFor={`grid-${id}`}>{label}</label>
      <div className="in">
        <input
          id={`grid-${id}`}
          className="num"
          inputMode="decimal"
          value={form[id]}
          onChange={(e) => set(id, e.target.value)}
        />
        {unit && <span className="muted">{unit}</span>}
      </div>
      {why(id)}
    </div>
  );

  const choice = <K extends "spacing" | "buyFirst">(
    key: K,
    label: string,
    options: [GridRequest[K], string][],
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
        aria-label={editing ? `Edit ${editing.name}` : "New grid bot"}
      >
        <h2 className="wizard-title">
          <CoinIcon coin={coin} />
          {coin}/{quote}
          {editing && <span className="ref">{editing.ref}</span>}
        </h2>
        <ol className="dca-steps grid-steps">
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
              <label htmlFor="grid-coin">Coin</label>
              <CoinSelect
                id="grid-coin"
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
            <div className="dca-two">
              {field("lower", "Lower price", quote)}
              {field("upper", "Upper price", quote)}
            </div>
            <div className="dca-two">
              {field("grids", "Grids", null)}
              {choice("spacing", "Spacing", [
                ["geometric", "Geometric"],
                ["arithmetic", "Arithmetic"],
              ])}
            </div>
            {preview && (
              <div className="dca-now muted">
                Profit per grid {preview.config.profitPerGrid[0]}%
                {preview.config.profitPerGrid[0] !== preview.config.profitPerGrid[1] &&
                  ` to ${preview.config.profitPerGrid[1]}%`}{" "}
                after fees.
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            {field("investment", "Investment", quote)}
            {choice("buyFirst", "Buy first", [
              [true, "Yes"],
              [false, "No"],
            ])}
            {field("stopBelow", "Stop below (optional)", quote)}
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

      <Preview preview={preview} error={previewError} />
    </div>
  );
}

function Preview({ preview, error }: { preview: GridPreview | null; error: string | null }) {
  const levels = useMemo<Level[]>(() => (preview ? linesOf(preview) : []), [preview]);
  if (error) {
    return (
      <section className="card dca-preview" aria-label="Grid">
        <div className="alert" role="alert">
          {error}
        </div>
      </section>
    );
  }
  if (!preview) {
    return (
      <section className="card dca-preview" aria-label="Grid">
        <div className="skeleton" style={{ height: 320 }} />
      </section>
    );
  }
  const q = preview.quote;
  const c = preview.config;
  const b = preview.backtest;
  const days = b.candles ? Math.round((b.to - b.from) / 86_400_000) : 0;
  const short = Number(preview.available) < Number(preview.opening.spend);
  const [low, high] = c.profitPerGrid;
  return (
    <section className="card dca-preview" aria-label="Grid">
      {!preview.inRange && <p className="wait dca-now">Today&apos;s price is outside the range.</p>}
      <div className="dca-tiles">
        <div>
          <span className="label">Per order</span>
          <b className="num">{quoteAmount(c.perOrder, q)}</b>
        </div>
        <div>
          <span className="label">Profit per grid</span>
          <b className="num up">{low === high ? `${low}%` : `${low}–${high}%`}</b>
        </div>
        <div>
          <span className="label">Opening buys</span>
          <b className="num">{quoteAmount(preview.opening.spend, q)}</b>
          <small className="muted">
            {preview.opening.buys} below
            {preview.opening.buyFirst > 0 && ` · ${preview.opening.buyFirst} at today's price`}
          </small>
        </div>
        <div>
          <span className="label">Available</span>
          <b className={`num ${short ? "down" : ""}`}>{quoteAmount(preview.available, q)}</b>
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
        levels={levels}
        label={`${preview.pair} hourly candles with the grid's ${levels.length} lines`}
      />
      <div className="dca-backtest" aria-label="Backtest">
        <div className="kv" style={{ padding: 0 }}>
          <span className="label">Backtest</span>
          <span className="label muted">last {days} days of hourly candles, fees included</span>
        </div>
        <div className="dca-tiles">
          <div>
            <span className="label">Round trips</span>
            <b className="num">{b.trips}</b>
          </div>
          <div>
            <span className="label">Grid profit</span>
            <b className={`num ${Number(b.gridProfit) > 0 ? "up" : ""}`}>
              {quoteAmount(b.gridProfit, q, true)}
            </b>
          </div>
          <div>
            <span className="label">Total vs holding</span>
            <b className={`num ${Number(b.totalPercent) < 0 ? "down" : "up"}`}>
              {Number(b.totalPercent) > 0 ? "+" : ""}
              {b.totalPercent}%
            </b>
            <small className="muted">
              holding {Number(b.holdPercent) > 0 ? "+" : ""}
              {b.holdPercent}%
            </small>
          </div>
          <div>
            <span className="label">Time in range</span>
            <b className="num">{b.inRange}%</b>
          </div>
        </div>
        <div className="dca-hint">
          Total includes the coins still held at the last price. Past results don&apos;t promise
          future ones.
        </div>
      </div>
    </section>
  );
}
