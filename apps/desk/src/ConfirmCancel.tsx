import { useEffect, useRef } from "react";
import { amount, price } from "./format";
import type { Order } from "./types";

// Asks before an open order is cancelled, so a slip of the mouse cancels nothing. Keep order
// has the focus; the cancel is red.
export default function ConfirmCancel({
  order,
  busy,
  onKeep,
  onCancel,
}: {
  order: Order | null;
  busy: boolean;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (order) {
      dialog.current?.showModal?.();
      keep.current?.focus();
    } else dialog.current?.close?.();
  }, [order]);
  const coin = order?.pair.split("/")[0] ?? "";
  return (
    <dialog ref={dialog} aria-labelledby="cancel-title" onClose={onKeep}>
      {order && (
        <>
          <h2 id="cancel-title">
            Cancel your {order.side.toLowerCase()} of {amount(order.amount)} {coin} at{" "}
            {price(order.price)}?
          </h2>
          <p>It comes off Binance straight away. You can place it again later.</p>
          <div className="dlg-btns">
            <button ref={keep} className="btn" type="button" onClick={onKeep}>
              Keep order
            </button>
            <button className="btn btn-danger" type="button" disabled={busy} onClick={onCancel}>
              Cancel order
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
