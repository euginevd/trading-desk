import { useCallback, useEffect, useState } from "react";
import { getSettings, setTrading } from "./api";
import Dashboard from "./Dashboard";
import Trade from "./Trade";
import type { Settings } from "./types";
import { Icon, type Status } from "./ui";

type Page = "dashboard" | "trade";

function pageFromHash(): Page {
  return window.location.hash === "#/trade" ? "trade" : "dashboard";
}

const STATUS: Record<Status, { word: string; tone: string; icon: "check" | "alert" | "clock" }> = {
  connected: { word: "Binance connected", tone: "positive", icon: "check" },
  demo: { word: "Demo data", tone: "positive", icon: "check" },
  fetching: { word: "Fetching", tone: "quiet", icon: "clock" },
  disconnected: { word: "Disconnected", tone: "critical", icon: "alert" },
};

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [status, setStatus] = useState<Status>("fetching");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const follow = () => setPage(pageFromHash());
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  useEffect(() => {
    getSettings().then(setSettings, () => setSettings(null));
  }, []);

  const onStatus = useCallback((next: Status) => setStatus(next), []);
  const onSettings = useCallback((next: Settings) => setSettings(next), []);

  const toggle = () => {
    if (!settings) return;
    setSwitching(true);
    setTrading(!settings.tradingOn).then(
      (next) => {
        setSettings(next);
        setSwitching(false);
      },
      () => setSwitching(false),
    );
  };

  const shown = STATUS[status];
  const on = settings?.tradingOn ?? false;

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <span className="name">Trading desk</span>
          <nav aria-label="Main">
            <a href="#/" aria-current={page === "dashboard" ? "page" : undefined}>
              Dashboard
            </a>
            <a href="#/trade" aria-current={page === "trade" ? "page" : undefined}>
              Trade terminal
            </a>
          </nav>
          <div className="right">
            <span className={`status ${shown.tone}`}>
              <Icon name={shown.icon} />
              {shown.word}
            </span>
            <button
              className="kill"
              type="button"
              aria-pressed={on}
              disabled={!settings || switching}
              onClick={toggle}
              title="Kill switch: off refuses every new order"
            >
              <span className={`dot ${on ? "on" : "off"}`} aria-hidden="true" />
              {settings ? (on ? "Trading on" : "Trading off") : "Trading unknown"}
            </button>
          </div>
        </div>
      </header>
      {page === "trade" ? (
        <Trade settings={settings} onSettings={onSettings} onStatus={onStatus} />
      ) : (
        <Dashboard onStatus={onStatus} />
      )}
    </>
  );
}
