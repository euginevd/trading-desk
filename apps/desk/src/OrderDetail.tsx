import { useEffect, useRef, useState } from "react";
import { ApiError, cancelOrder, editOrder, getMarket } from "./api";
import { BotChart, type Level } from "./BotKit";
import ConfirmCancel from "./ConfirmCancel";
import CoinIcon from "./CoinIcon";
import { amount as coinAmount, dateTime, price } from "./format";
import { entryLevels } from "./KeyLevels";
import type { Market, Order } from "./types";
import { dragPanel, placed } from "./WidgetDetails";

// An open order on the pair's chart (decision 43): where it sits against the price and the
// levels that matter, how far the price has to move to fill it, and its price or amount
// changed in one step.

const two = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Try again.";
}

export default function OrderDetail({
  order,
  at = null,
  onClose,
  onDone,
}: {
  order: Order | null;
  at?: DOMRect | null;
  onClose: () => void;
  onDone: (note?: string, problem?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (order) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [order]);
  return (
    <dialog
      ref={dialog}
      className="detail-panel in-place"
      style={placed(at)}
      aria-labelledby="order-title"
      onClose={onClose}
    >
      {order && (
        <OrderView
          key={order.orderId}
          order={order}
          onClose={() => dialog.current?.close?.()}
          onDone={onDone}
        />
      )}
    </dialog>
  );
}

function OrderView({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: (note?: string, problem?: string) => void;
}) {
  const [market, setMarket] = useState<Market | null>(null);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [at, setAt] = useState(order.price);
  const [qty, setQty] = useState(order.amount);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [id] = useState(() => crypto.randomUUID());
  useEffect(() => {
    getMarket(order.symbol, "1h").then(setMarket, () => setMarket(null));
  }, [order.symbol]);

  const buy = order.side === "Buy";
  const now = Number(market?.price ?? 0);
  const target = Number(editing ? at : order.price);
  const away = now > 0 ? ((target - now) / now) * 100 : null;
  const quote = order.pair.split("/")[1] ?? "";
  const reaching =
    away === null
      ? ""
      : buy
        ? away < 0
          ? `Fills if the price falls ${Math.abs(away).toFixed(1)}% to ${price(String(target))}`
          : "At or above today's price: it should fill straight away"
        : away > 0
          ? `Fills if the price rises ${away.toFixed(1)}% to ${price(String(target))}`
          : "At or under today's price: it should fill straight away";

  const levels: Level[] = [
    { price: target, title: buy ? "Your buy" : "Your sell", tone: buy ? "base" : "sell" },
    ...(market
      ? entryLevels(market).map<Level>((l) => ({ price: l.value, title: l.name, tone: "muted" }))
      : []),
  ];

  const save = () => {
    setBusy(true);
    setError("");
    editOrder({
      symbol: order.symbol,
      orderId: order.orderId,
      price: at,
      amount: qty,
      clientId: id,
    }).then(
      (done) => {
        setBusy(false);
        onClose();
        onDone(done.message);
      },
      (e: unknown) => {
        setBusy(false);
        setError(message(e));
      },
    );
  };
  const cancel = () => {
    setBusy(true);
    cancelOrder(order.symbol, order.orderId).then(
      (done) => {
        onClose();
        onDone(done.message);
      },
      (e: unknown) => {
        setBusy(false);
        setError(message(e));
      },
    );
  };

  return (
    <>
      <div className="detail-head" onPointerDown={dragPanel}>
        <h2 id="order-title" className="wizard-title" style={{ margin: 0 }}>
          <CoinIcon coin={order.pair.split("/")[0] ?? ""} />
          {order.pair}
          <span className={`tag ${buy ? "buy" : "sell"}`}>{order.side}</span>
        </h2>
        <button type="button" className="link" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {away !== null && (
        <p className={`detail-summary ${Math.abs(away) < 1 ? "up" : ""}`}>{reaching}</p>
      )}
      {market && market.candles.length > 1 ? (
        <BotChart
          candles={market.candles}
          levels={levels}
          height={260}
          label={`${order.pair} hourly candles with this order and the nearest levels`}
        />
      ) : (
        <div className="skeleton" style={{ height: 260 }} />
      )}
      <div className="kv">
        <span className="muted">Price now · your order</span>
        <span className="num">
          {price(market?.price ?? null)} · {price(order.price)}
        </span>
      </div>
      <div className="kv">
        <span className="muted">Amount · value</span>
        <span className="num">
          {coinAmount(order.amount)} · {two.format(Number(order.price) * Number(order.amount))}{" "}
          {quote}
        </span>
      </div>
      <div className="kv">
        <span className="muted">Placed · filled</span>
        <span className="num">
          {dateTime(order.time)} · {coinAmount(order.filled)}
        </span>
      </div>

      {editing ? (
        <div className="order-edit">
          <div className="dca-two">
            <div className="field">
              <label htmlFor="edit-price">Limit price</label>
              <div className="in">
                <input
                  id="edit-price"
                  className="num"
                  inputMode="decimal"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                />
                <span className="muted">{quote}</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="edit-amount">Amount</label>
              <div className="in">
                <input
                  id="edit-amount"
                  className="num"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="dca-reason">
            New value {two.format(Number(at) * Number(qty) || 0)} {quote}. Binance swaps the order
            in one step; if it filled meanwhile, nothing changes.
          </div>
        </div>
      ) : null}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dca-nav">
        <button className="btn btn-danger-quiet" type="button" onClick={() => setAsking(true)}>
          Cancel order
        </button>
        <ConfirmCancel
          order={asking ? order : null}
          busy={busy}
          onKeep={() => setAsking(false)}
          onCancel={cancel}
        />
        {editing ? (
          <div className="row-actions" style={{ width: "auto" }}>
            <button className="btn" type="button" onClick={() => setEditing(false)}>
              Back
            </button>
            <button className="btn btn-accent" type="button" disabled={busy} onClick={save}>
              Save changes
            </button>
          </div>
        ) : (
          <button className="btn btn-accent" type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
    </>
  );
}
