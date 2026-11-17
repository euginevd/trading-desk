// The Bots page in three tabs (owner, 17 Nov 2026): Accumulation, the long-term DCA book run by
// dca-agent; Opportunities, the short-term DCA bots (day and swing entries, volume-triggered
// buys) on a budget of their own; and Grid bots. The tabs are links, so the Dashboard's DCA
// widget and the old #/dca and #/grid links open the right one.
import BotsPage from "./BotsPage";
import DcaBookPage from "./DcaBookPage";

export type BotsTab = "accumulate" | "opportunities" | "grid";

const TABS: [BotsTab, string, string][] = [
  ["accumulate", "Accumulation", "#/dca-book"],
  ["opportunities", "Opportunities", "#/bots?dca"],
  ["grid", "Grid bots", "#/bots?grid"],
];

export default function BotsHome({ tab }: { tab: BotsTab }) {
  return (
    <>
      <nav className="botsh-tabs wrap" aria-label="Bots">
        {TABS.map(([key, name, href]) => (
          <a key={key} href={href} aria-current={tab === key ? "page" : undefined}>
            {name}
          </a>
        ))}
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
