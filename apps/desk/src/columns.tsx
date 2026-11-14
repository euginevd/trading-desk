import { type CSSProperties, type KeyboardEvent, type PointerEvent, useState } from "react";

// A size the owner sets by dragging a grip (design-system 19): the Trade page's watchlist width
// and chart height. Dragged, nudged with the arrow keys, reset by a double-click, remembered per
// browser.
type Grip = {
  key: string; // localStorage key
  initial: number;
  min: number;
  max: number;
  axis: "x" | "y"; // x: drag right to grow; y: drag down to grow
  cssVar: string;
  label: string;
  className: string;
};

const STEP = 16;

function useGrip(g: Grip) {
  const clamp = (px: number) => Math.round(Math.min(g.max, Math.max(g.min, px)));
  const [size, setSize] = useState(() => {
    try {
      const kept = Number(window.localStorage.getItem(g.key));
      return kept ? clamp(kept) : g.initial;
    } catch {
      return g.initial;
    }
  });

  const set = (px: number) => {
    const next = clamp(px);
    setSize(next);
    try {
      window.localStorage.setItem(g.key, String(next));
    } catch {
      // private window: the size lasts for this visit only
    }
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const start = g.axis === "x" ? e.clientX : e.clientY;
    document.body.classList.add("resizing", `resizing-${g.axis}`);
    const move = (m: globalThis.PointerEvent) =>
      set(size + (g.axis === "x" ? m.clientX : m.clientY) - start);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing", `resizing-${g.axis}`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const [less, more] = g.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === less || e.key === more) {
      e.preventDefault();
      set(size + (e.key === more ? STEP : -STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      set(g.initial);
    }
  };

  // Rendered inline (not a component of its own), so the grip isn't remounted mid-drag.
  const grip = (
    <button
      type="button"
      className={g.className}
      aria-label={`${g.label}, ${size} pixels`}
      data-size={size}
      title="Drag to resize, or use the arrow keys; double-click to reset"
      onPointerDown={down}
      onKeyDown={key}
      onDoubleClick={() => set(g.initial)}
    />
  );

  return { size, style: { [g.cssVar]: `${size}px` } as CSSProperties, grip };
}

export function useColumns() {
  return useGrip({
    key: "desk.trade.watchlist",
    initial: 260,
    min: 200,
    max: 480,
    axis: "x",
    cssVar: "--col-left",
    label: "Resize watchlist",
    className: "col-grip",
  });
}

export function useChartHeight() {
  return useGrip({
    key: "desk.trade.chartHeight",
    initial: 560,
    min: 320,
    max: 1200,
    axis: "y",
    cssVar: "--chart-height",
    label: "Resize chart height",
    className: "row-grip",
  });
}
