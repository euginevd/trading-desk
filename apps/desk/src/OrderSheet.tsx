// The Trade page's order sheet (TODO 6): one limit order, opened from the agent's ticket, a link
// from elsewhere, or "Place my own order". It only fills the form: the owner reviews and confirms
// each order, and the api still checks the kill switch, the limits and the Profile's rules.
import { useEffect, useRef, useState } from "react";
import { amount as coinAmount, aud, price } from "./format";
import { floor, LimitsLine, OrderConfirm, useSellCheck, YoungLotWarning } from "./SmartTrade";
import type { AgentTicket, Settings, Terminal } from "./types";

const two = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface SheetStart {
  n: number; // a new number opens a fresh form
  side: "buy" | "sell";
  price: string;
  qty: string;
  from: "agent" | "link" | "own";
  why?: string; // a link's reason, e.g. "rebalance"
  ticket?: AgentTicket; // the agent's order, checked against the Profile as it stands
  // Logged against the run once this order is placed: Use this order or Edit.
  choice?: { runId: number; choice: "used" | "edited" };
  audPerUsd?: string;
}

function fromLine(start: SheetStart, agentName: string): string | null {
  if (start.from === "agent")
    return `Filled from ${agentName}'s call. Change anything; you still confirm.`;
  if (start.from === "link")
    return start.why === "rebalance"
      ? "Filled from your Portfolio: back toward your target allocation. You still confirm."
      : "Filled from a link. Check it; you still confirm.";
  return null;
}

export default function OrderSheet({
  start,
  terminal,
  settings,
  agentName,
  onClose,
  onPlaced,
  onSettings,
  onSmartTrade,
}: {
  start: SheetStart;
  terminal: Terminal;
  settings: Settings;
  agentName: string;
  onClose: () => void;
  onPlaced: (note: string) => void;
  onSettings: (s: Settings) => void;
  onSmartTrade: (side: "buy" | "sell", at: string) => void;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    sheet.current?.showModal?.();
  }, []);
  const [side, setSide] = useState(start.side);
  const [at, setAt] = useState(() =>
    Number(start.price) > 0 ? floor(Number(start.price), terminal.tick) : terminal.price,
  );
  const [qty, setQty] = useState(() =>
    Number(start.qty) > 0 ? floor(Number(start.qty), terminal.step) : "",
  );
  const [error, setError] = useState("");
  const [clientId] = useState(() => crypto.randomUUID());
  const check = useSellCheck(terminal.base, side === "sell" ? qty : "");

  const base = terminal.base;
  const q = terminal.quote;
  const total = Number(at) * Number(qty) || 0;
  const off = !settings.tradingOn;
  const unset = Number(settings.perOrder) <= 0;
  const ready = Number(at) > 0 && Number(qty) > 0;
  const far = Number(terminal.price) > 0 && Math.abs(Number(at) / Number(terminal.price) - 1) > 0.1;
  const ticket = start.ticket;
  // The ticket's check holds only while the form is still the ticket's order.
  const asTicket =
    ticket !== undefined &&
    side === ticket.side &&
    Number(at) === Number(floor(Number(ticket.price), terminal.tick)) &&
    Number(qty) === Number(floor(Number(ticket.qty), terminal.step));
  const note = fromLine(start, agentName);
  const close = () => sheet.current?.close?.();

  return (
    <dialog ref={sheet} className="tr-sheet" aria-labelledby="tr-sheet-title" onClose={onClose}>
      <h2 id="tr-sheet-title">
        Limit {side} {base}
      </h2>
      {note && <p className="tr-from">{note}</p>}
      <div className="seg" role="group" aria-label="Side">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            className={side === s ? `on-${s}` : ""}
            onClick={() => setSide(s)}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="tr-price">Price</label>
        <div className="in">
          <input
            id="tr-price"
            className="num"
            inputMode="decimal"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
          <span className="muted">{q}</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="tr-qty">Amount</label>
        <div className="in">
          <input
            id="tr-qty"
            className="num"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <span className="muted">{base}</span>
        </div>
        {side === "sell" && (
          <div className="pcts">
            {[0.25, 0.5, 1].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setQty(floor(Number(terminal.baseFree) * f, terminal.step))}
              >
                {f === 1 ? "Max" : `${f * 100}%`}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="kv tr-total">
        <span className="muted">Total</span>
        <span className="num">
          {two.format(total)} {q}
          {start.audPerUsd && total > 0 && ` · ${aud(String(total * Number(start.audPerUsd)))}`}
        </span>
      </div>
      <div className="kv tr-total">
        <span className="muted">{side === "buy" ? "Available" : "Held"}</span>
        <span className="num">
          {side === "buy"
            ? `${two.format(Number(terminal.quoteFree))} ${q}`
            : `${coinAmount(terminal.baseFree)} ${base}`}
        </span>
      </div>
      {far && (
        <div className="tax-warn" role="note">
          <b>Far from the market.</b> This limit is more than 10% from today&apos;s price (
          {price(terminal.price)}). Check it before you place it.
        </div>
      )}
      {side === "sell" && <YoungLotWarning check={check} qty={qty} base={base} />}
      {asTicket && ticket ? (
        ticket.breaks.length === 0 ? (
          ticket.side === "sell" ? (
            <p className="tr-check plain">Sells don&apos;t count against your buy rules.</p>
          ) : (
            <div className="tr-check ok">
              <span aria-hidden="true">✓</span> Within your Profile rules
            </div>
          )
        ) : (
          <div className="tr-check bad" role="note">
            <b>Breaks your Profile</b>
            <ul>
              {ticket.breaks.map((b) => (
                <li key={`${b.rule}-${b.message}`}>
                  {b.label}: {b.message}
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <p className="tr-fine muted">Your Profile&apos;s rules are checked when you place it.</p>
      )}
      <LimitsLine settings={settings} quote={q} onSaved={onSettings} />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="tr-sheet-foot">
        <button
          type="button"
          className={`btn tr-review ${side}`}
          disabled={off || unset || !ready}
          onClick={() => {
            setError("");
            confirm.current?.showModal?.();
          }}
        >
          {off
            ? "Trading is off"
            : unset
              ? "Set your limits first"
              : `Review limit ${side} ${base}`}
        </button>
        <button type="button" className="btn tr-ghost" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="link tr-smart-link"
          disabled={!(Number(at) > 0)}
          onClick={() => {
            onSmartTrade(side, at);
            close();
          }}
        >
          Make it a smart trade, with DCA orders and exits
        </button>
      </div>
      <OrderConfirm
        dialog={confirm}
        request={{ clientId, symbol: terminal.symbol, side, price: at, amount: qty }}
        title={`Limit ${side} ${qty} ${base} at ${price(at)}?`}
        label={`Place limit ${side}`}
        onPlaced={(placed) => {
          onPlaced(placed);
          close();
        }}
        onError={setError}
      >
        <p>
          {two.format(total)} {q}, one order with no exits. It sits in Open orders until it fills or
          you cancel it.
        </p>
      </OrderConfirm>
    </dialog>
  );
}
