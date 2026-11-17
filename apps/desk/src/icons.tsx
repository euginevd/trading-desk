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
