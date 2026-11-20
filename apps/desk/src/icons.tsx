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

export const SettingsIcon = () => (
  <svg {...base}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const PlanIcon = () => (
  <svg {...base}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </svg>
);

export const PortfolioIcon = () => (
  <svg {...base}>
    <path d="M21 12a9 9 0 1 1-9-9v9z" />
    <path d="M14.5 2.8A9 9 0 0 1 21.2 9.5H14.5z" />
  </svg>
);

export const JournalIcon = () => (
  <svg {...base}>
    <path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z" />
    <path d="M6 3v18M10 8h5M10 12h5" />
  </svg>
);

export const TradeIcon = () => (
  <svg {...base}>
    <path d="M7 3v4M7 17v4M17 6v3M17 17v3" />
    <rect x="4.5" y="7" width="5" height="10" rx="1" />
    <rect x="14.5" y="9" width="5" height="8" rx="1" />
  </svg>
);

// Backtest: a line of results over time, with a turn-back arrow.
export const BacktestIcon = () => (
  <svg {...base}>
    <path d="M4 19h16" />
    <path d="M6 15l4-4 3 3 5-6" />
    <path d="M3 6.5A4.5 4.5 0 0 1 11 4" />
    <path d="M3 3v3.5h3.5" />
  </svg>
);

export const RiskIcon = () => (
  <svg {...base}>
    <path d="M12 3.5l7 2.8V11c0 4.4-2.9 7.8-7 9.5-4.1-1.7-7-5.1-7-9.5V6.3z" />
    <path d="M12 8v4.5M12 15.5h.01" />
  </svg>
);

export const DcaIcon = () => (
  <svg {...base}>
    <rect x="4" y="7" width="16" height="12" rx="3" />
    <path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5" />
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

// Pill icons (design-system 13k): 16px, beside a tab's or filter's word, never instead of it.
const pill = { ...base, width: 16, height: 16 };

export const LayersIcon = () => (
  <svg {...pill}>
    <path d="M12 4l8 4-8 4-8-4z" />
    <path d="M4 12l8 4 8-4M4 16l8 4 8-4" />
  </svg>
);

export const ExchangeIcon = () => (
  <svg {...pill}>
    <rect x="3.5" y="6" width="17" height="12" rx="3" />
    <path d="M3.5 10h17" />
  </svg>
);

export const PillWalletIcon = () => (
  <svg {...pill}>
    <path d="M5 7.5h12.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h10" />
    <circle cx="16" cy="13.3" r="1" />
  </svg>
);

export const CoinsIcon = () => (
  <svg {...pill}>
    <ellipse cx="9" cy="7" rx="5" ry="2.5" />
    <path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7" />
    <path d="M10 15.5c.6 1.2 2.6 2 5 2 2.8 0 5-1.1 5-2.5V11c0-1.3-1.9-2.4-4.5-2.5" />
  </svg>
);

export const ClockIcon = () => (
  <svg {...pill}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l2.5 2" />
  </svg>
);

export const ListIcon = () => (
  <svg {...pill}>
    <path d="M9 7h10M9 12h10M9 17h10M5 7h.01M5 12h.01M5 17h.01" />
  </svg>
);

export const ReceiptIcon = () => (
  <svg {...pill}>
    <path d="M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.5-1.5 1.5-2-1.5L6 20.5z" />
    <path d="M9 8h6M9 11.5h6M9 15h3" />
  </svg>
);

export const BoltIcon = () => (
  <svg {...pill}>
    <path d="M13 3.5L5.5 13H12l-1 7.5 7.5-9.5H12z" />
  </svg>
);

export const GridLinesIcon = () => (
  <svg {...pill}>
    <path d="M4 8h16M4 12h16M4 16h16" strokeDasharray="2 2.5" />
    <path d="M4 19l5-6 4 3 7-9" />
  </svg>
);
