// Every box that opens over the page closes on Esc (the browser's own) and on a click outside it
// (design-system 9a). A modal dialog's backdrop belongs to the dialog element, so a click whose
// press and release both land outside the dialog's box closes it; a drag that starts inside,
// such as selecting text, doesn't. Closing goes through close(), so each dialog's onClose runs,
// and a confirm dialog lands on its default: keep.
function outside(dialog: HTMLDialogElement, x: number, y: number): boolean {
  const box = dialog.getBoundingClientRect();
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

export function closeOnClickAway(doc: Document): () => void {
  let pressed: HTMLDialogElement | null = null;
  const down = (e: PointerEvent) => {
    const target = e.target;
    pressed =
      target instanceof HTMLDialogElement && target.open && outside(target, e.clientX, e.clientY)
        ? target
        : null;
  };
  const click = (e: MouseEvent) => {
    const target = e.target;
    if (target === pressed && pressed && outside(pressed, e.clientX, e.clientY)) pressed.close();
    pressed = null;
  };
  doc.addEventListener("pointerdown", down);
  doc.addEventListener("click", click);
  return () => {
    doc.removeEventListener("pointerdown", down);
    doc.removeEventListener("click", click);
  };
}
