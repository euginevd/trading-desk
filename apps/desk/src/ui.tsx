import { trend } from "./format";

export type Status = "connected" | "demo" | "fetching" | "disconnected";

type IconName = "check" | "refresh" | "alert" | "clock" | "shield" | "minus" | "x";

export function Icon({ name }: { name: IconName }) {
  const paths = {
    check: <path d="M20 6 9 17l-5-5" />,
    refresh: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
    alert: (
      <>
        <path d="M12 9v4M12 17h.01" />
        <circle cx="12" cy="12" r="10" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    minus: <path d="M5 12h14" />,
    x: <path d="M18 6 6 18M6 6l12 12" />,
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Signed({ value, children }: { value: string | null; children: string }) {
  return <span className={trend(value)}>{children}</span>;
}
