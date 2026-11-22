// Feature flags (decision 85): the one list of the desk's pages and features, each switched on or
// off in Settings › Pages. The api keeps only the owner's choices; a feature they haven't touched
// is on when `startsOn` says so. Off only hides it and skips loading its code: no order, bot,
// check or agent reads these.
//
// To add a feature behind a switch: add a line here with `startsOn: false` (it arrives off,
// tagged New), then wrap what it shows in `useFeature("<id>")` or `<Feature id="<id>">`.
import { createContext, type ReactNode, useContext } from "react";

export type FeatureId =
  | "dashboard"
  | "portfolio"
  | "journal"
  | "trade"
  | "backtest"
  | "risk"
  | "tax"
  | "bots"
  | "profile"
  | "settings";

export type FeatureInfo = {
  id: FeatureId;
  name: string;
  what: string;
  // On before the owner chooses: today's pages are, so nothing vanished when the switches came.
  startsOn: boolean;
  // Dashboard and Settings: the way back to the switches.
  always?: boolean;
  // What keeps running while it's hidden, said beside its switch when it's off.
  keeps?: string;
};

export const FEATURES: FeatureInfo[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    what: "The morning view and its widgets",
    startsOn: true,
    always: true,
  },
  { id: "portfolio", name: "Portfolio", what: "Binance and your Ledger", startsOn: true },
  { id: "journal", name: "Journal", what: "Your trades with tags and notes", startsOn: true },
  {
    id: "trade",
    name: "Trade",
    what: "The Trading account and New trade",
    startsOn: true,
    keeps: "Open trades keep their stops and targets",
  },
  {
    id: "backtest",
    name: "Backtest",
    what: "Test a style on one coin's past candles, up to 3 months",
    startsOn: true,
  },
  {
    id: "risk",
    name: "Risk",
    what: "The biggest risks to your holdings",
    startsOn: true,
    keeps: "Your limits are still checked on every order",
  },
  {
    id: "tax",
    name: "Tax",
    what: "Gains and losses by financial year, lots, and staking income",
    startsOn: true,
  },
  {
    id: "bots",
    name: "Bots",
    what: "Accumulation (the DCA book), Opportunities and Grid bots",
    startsOn: true,
    keeps: "Bots you switched on keep running",
  },
  {
    id: "profile",
    name: "Profile",
    what: "Your Investment Policy Statement and My agents",
    startsOn: true,
  },
  { id: "settings", name: "Settings", what: "This page", startsOn: true, always: true },
];

export type Flags = Partial<Record<string, boolean>>;

export function featureOn(flags: Flags, id: FeatureId): boolean {
  const info = FEATURES.find((f) => f.id === id);
  if (!info) return false;
  if (info.always) return true;
  return flags[id] ?? info.startsOn;
}

// A feature that starts off and that the owner hasn't switched yet: tagged New in Settings.
export const isNew = (flags: Flags, info: FeatureInfo) =>
  !info.startsOn && flags[info.id] === undefined;

type Features = {
  // Null until the api answers; then the owner's choices (empty if it couldn't be read).
  flags: Flags | null;
  switchFeature: (id: FeatureId, on: boolean) => Promise<void>;
};

export const FeaturesContext = createContext<Features>({
  flags: {},
  switchFeature: () => Promise.resolve(),
});

export const useFeatures = () => useContext(FeaturesContext);

// Whether a feature shows. Off while the flags are loading, so a hidden page never flashes up.
export function useFeature(id: FeatureId): boolean {
  const { flags } = useFeatures();
  return flags !== null && featureOn(flags, id);
}

export function Feature({ id, children }: { id: FeatureId; children: ReactNode }) {
  return useFeature(id) ? children : null;
}
