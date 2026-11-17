// The Bots page in three tabs (owner, 17 Nov 2026): Accumulation, the long-term DCA book run by
// dca-agent; Opportunities, the short-term DCA bots (day and swing entries, volume-triggered
// buys) on a budget of their own; and Grid bots. The tabs are links, so the Dashboard's DCA
// widget and the old #/dca and #/grid links open the right one.
import BotsPage from "./BotsPage";
import DcaBookPage from "./DcaBookPage";
import { BoltIcon, GridLinesIcon, LayersIcon } from "./icons";

export type BotsTab = "accumulate" | "opportunities" | "grid";

const TABS: [BotsTab, string, string, () => React.JSX.Element][] = [
  ["accumulate", "Accumulation", "#/dca-book", LayersIcon],
  ["opportunities", "Opportunities", "#/bots?dca", BoltIcon],
  ["grid", "Grid bots", "#/bots?grid", GridLinesIcon],
];

export default function BotsHome({ tab }: { tab: BotsTab }) {
  return (
    <>
      <nav className="botsh-tabs wrap" aria-label="Bots">
        <div className="track">
          {TABS.map(([key, name, href, Icon]) => (
            <a key={key} href={href} aria-current={tab === key ? "page" : undefined}>
              <Icon />
              {name}
            </a>
          ))}
        </div>
      </nav>
      {tab === "accumulate" ? (
        <DcaBookPage />
      ) : (
        <BotsPage
          only={tab === "grid" ? "grid" : "dca"}
          note={
            tab === "opportunities" ? (
              <p className="botsh-budget">
                <b>Budget: none allocated yet.</b> Opportunity bots spend money of their own, kept
                apart from the DCA book and the Trading account.
              </p>
            ) : null
          }
        />
      )}
    </>
  );
}
