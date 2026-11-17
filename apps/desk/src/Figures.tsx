// Figures shared by the Profile and the Dashboard (decisions 62 and 63): money rounded to K or M,
// and a live figure that rolls when it moves.
import { type ReactNode, useState } from "react";
import type { Num } from "./types";

const n = (v: Num | number | undefined) => (v === null || v === undefined ? null : Number(v));

// Rounded with K or M: US$42K, A$63K, US$1M; one decimal below 10K (A$4.7K), so a small figure
// still moves when it changes.
export function km(value: Num | number | undefined, currency: "A$" | "US$" | "" = "A$"): string {
  const v = n(value);
  if (v === null || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const trim = (x: number, places: number) => String(Number(x.toFixed(places)));
  if (a >= 999_500) return `${sign}${currency}${trim(a / 1_000_000, 2)}M`;
  if (a >= 1_000) return `${sign}${currency}${trim(a / 1_000, a >= 9_950 ? 0 : 1)}K`;
  return `${sign}${currency}${Math.round(a)}`;
}

// A live figure: when the refresh brings a new value, it rolls in from the direction it moved,
// tinted mint (up) or red (down) for a moment. The first value just appears.
export function Live({ value, children }: { value: Num | undefined; children: ReactNode }) {
  const now = value === null || value === undefined ? null : Number(value);
  const [seen, setSeen] = useState({ value: now, dir: "", turn: 0 });
  if (seen.value !== now) {
    // Worked out while rendering, so the new value rolls in on the very frame it appears.
    const moved = seen.value !== null && now !== null;
    setSeen({
      value: now,
      dir: moved ? (now > (seen.value ?? 0) ? "rise" : "fall") : "",
      turn: moved ? seen.turn + 1 : seen.turn,
    });
  }
  return (
    <span key={seen.turn} className={`pf-live${seen.dir ? ` ${seen.dir}` : ""}`}>
      {children}
    </span>
  );
}
