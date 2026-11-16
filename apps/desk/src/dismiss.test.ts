import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOnClickAway } from "./dismiss";

function openDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  dialog.getBoundingClientRect = () =>
    ({ left: 100, right: 300, top: 100, bottom: 300 }) as DOMRect;
  dialog.close = vi.fn(() => dialog.removeAttribute("open"));
  document.body.append(dialog);
  return dialog;
}

function press(target: Element, x: number, y: number) {
  const down = new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y });
  target.dispatchEvent(down);
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
}

let stop: () => void = () => undefined;
afterEach(() => {
  stop();
  document.body.innerHTML = "";
});

describe("click away", () => {
  it("closes an open dialog when the backdrop is clicked", () => {
    stop = closeOnClickAway(document);
    const dialog = openDialog();
    press(dialog, 20, 20);
    expect(dialog.close).toHaveBeenCalledTimes(1);
  });

  it("keeps it open for a click inside it, or a drag that started inside", () => {
    stop = closeOnClickAway(document);
    const dialog = openDialog();
    press(dialog, 150, 150);
    dialog.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 150, clientY: 150 }),
    );
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }));
    expect(dialog.close).not.toHaveBeenCalled();
  });
});
