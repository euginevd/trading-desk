// The Bots page (owner, 21 Nov 2026): two tabs, DCA bots and Grid bots. DCA bots has two
// kinds: Weekly buys, the long-term DCA book run by dca-agent (buy and hold for years, five
// coins, Friday limits), and Swing bots, short deals that buy dips and sell the whole deal at a
// small profit, for a sideways market, on a budget of their own. Grid bots trade inside a set
// range. Every view is a link, so the Dashboard and the old #/dca and #/grid links open it.
import BotsPage from "./BotsPage";
import DcaBookPage from "./DcaBookPage";
import { GridLinesIcon, LayersIcon } from "./icons";

export type BotsTab = "accumulate" | "opportunities" | "grid";

const TABS: [string, string, string, () => React.JSX.Element][] = [
  ["dca", "DCA bots", "#/dca-book", LayersIcon],
  ["grid", "Grid bots", "#/bots?grid", GridLinesIcon],
];
const KINDS: [BotsTab, string, string, string][] = [
  ["accumulate", "Weekly buys", "#/dca-book", "Buy and hold for years"],
  ["opportunities", "Swing bots", "#/bots?dca", "Short deals for a sideways market"],
];

export default function BotsHome({ tab }: { tab: BotsTab }) {
  const top = tab === "grid" ? "grid" : "dca";
  return (
    <>
      <nav className="botsh-tabs wrap" aria-label="Bots">
        <div className="track">
          {TABS.map(([key, name, href, Icon]) => (
            <a key={key} href={href} aria-current={top === key ? "page" : undefined}>
              <Icon />
              {name}
            </a>
          ))}
        </div>
        {top === "dca" && (
          <div className="views botsh-kinds" role="group" aria-label="Kind of DCA bot">
            {KINDS.map(([key, name, href, words]) => (
              <a
                key={key}
                href={href}
                aria-current={tab === key ? "page" : undefined}
                title={words}
              >
                {name}
              </a>
            ))}
          </div>
        )}
      </nav>
      {tab === "accumulate" ? (
        <DcaBookPage />
      ) : (
        <BotsPage
          only={tab === "grid" ? "grid" : "dca"}
          note={
            tab === "opportunities" ? (
              <p className="botsh-budget">
                <b>Budget: none allocated yet.</b> Swing bots spend money of their own, kept apart
                from Weekly buys and the Trading account.
              </p>
            ) : null
          }
        />
      )}
    </>
  );
}
