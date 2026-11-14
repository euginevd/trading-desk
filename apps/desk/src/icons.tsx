// Side panel icons: 18px, drawn in the current text colour.
const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const DashboardIcon = () => (
  <svg {...base}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const TradeIcon = () => (
  <svg {...base}>
    <path d="M7 3v4M7 17v4M17 6v3M17 17v3" />
    <rect x="4.5" y="7" width="5" height="10" rx="1" />
    <rect x="14.5" y="9" width="5" height="8" rx="1" />
  </svg>
);

export const DcaIcon = () => (
  <svg {...base}>
    <rect x="4" y="7" width="16" height="12" rx="3" />
    <path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5" />
  </svg>
);

export const GridIcon = () => (
  <svg {...base}>
    <path d="M3 8h18M3 16h18" strokeDasharray="2 3" />
    <path d="M3 19l5-7 4 4 4-9 5 6" />
  </svg>
);

// Two chevrons pointing left; the folded panel turns them to point right.
export const CollapseIcon = () => (
  <svg {...base} width={14} height={14} strokeWidth={2.2}>
    <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
  </svg>
);

export const MenuIcon = () => (
  <svg {...base}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const PowerIcon = () => (
  <svg {...base}>
    <path d="M12 3v8" />
    <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
  </svg>
);

// A wallet or exchange logo in a status pill: the coin's logo from the api, or a wallet glyph.
export const WalletIcon = () => (
  <svg {...base}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 9h15M16 13.5h2" />
  </svg>
);

export const ResetIcon = () => (
  <svg {...base} width={14} height={14} strokeWidth={2}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);
