// Sections that fold, like the Trade page's watchlist: the head is one button across the row
// (title, a one-line summary, the chevron), with room for an action at its end; whether each is
// open is kept per browser. useFold and FoldHead fit a section with its own frame (the DCA
// book's Plan and Orders); Fold is the whole section.
import { useState, type ReactNode } from "react";

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v !== "0";
  } catch {
    return fallback;
  }
}

export function useFold(id: string, startOpen = true): [boolean, () => void] {
  const key = `desk.fold.${id}`;
  const [open, setOpen] = useState(() => readOpen(key, startOpen));
  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(key, o ? "0" : "1");
      } catch {
        // not kept: the default next time
      }
      return !o;
    });
  return [open, toggle];
}

export function FoldHead({
  id,
  open,
  onToggle,
  title,
  summary,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  title: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="acc-fold"
      aria-expanded={open}
      aria-controls={`${id}-body`}
      onClick={onToggle}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      {/* The summary is for a folded section: open, its content says it. */}
      {summary && !open && <span className="fold-sum num">{summary}</span>}
    </button>
  );
}

export default function Fold({
  id,
  title,
  summary,
  open: startOpen = true,
  end,
  className = "",
  children,
}: {
  id: string;
  title: ReactNode;
  summary?: ReactNode;
  open?: boolean;
  end?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, toggle] = useFold(id, startOpen);
  return (
    <section
      className={`dcb-section fold${open ? "" : " is-folded"} ${className}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="dcb-section-head">
        <FoldHead id={id} open={open} onToggle={toggle} title={title} summary={summary} />
        {open && end}
      </div>
      {open && <div id={`${id}-body`}>{children}</div>}
    </section>
  );
}
