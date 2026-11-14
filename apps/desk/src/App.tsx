import { useCallback, useEffect, useState } from "react";
import { getGlobal, getPortfolio, getSettings, getTickers, setTrading } from "./api";
import { percent, price, trend, usdShort } from "./format";
import DcaBots from "./DcaBots";
import GridBots from "./GridBots";
import {
  CollapseIcon,
  DashboardIcon,
  DcaIcon,
  GridIcon,
  MenuIcon,
  PowerIcon,
  TradeIcon,
  WalletIcon,
} from "./icons";
import Portfolio from "./Portfolio";
import { CURRENCIES, type Currency, money } from "./money";
import Trade from "./Trade";
import type { MarketGlobal, Settings, TaoWallet, Ticker } from "./types";
import type { Status } from "./ui";

type Page = "dashboard" | "trade" | "dca" | "grid";
const TICK_MS = 30_000;
const CURRENCY_KEY = "desk.currency";
function readCurrency(): Currency {
  try {
    const kept = window.localStorage.getItem(CURRENCY_KEY);
    return CURRENCIES.find((c) => c === kept) ?? "AUD";
  } catch {
    return "AUD";
  }
}
const TOTAL_MS = 300_000; // the header's total, every five minutes
const FOLDED_KEY = "desk.side.folded";

const PAGES: { page: Page; hash: string; name: string; Icon: () => React.JSX.Element }[] = [
  { page: "dashboard", hash: "#/", name: "Dashboard", Icon: DashboardIcon },
  { page: "trade", hash: "#/trade", name: "Trade", Icon: TradeIcon },
];
const BOT_PAGES: typeof PAGES = [
  { page: "dca", hash: "#/dca", name: "DCA Bot", Icon: DcaIcon },
  { page: "grid", hash: "#/grid", name: "Grid Bot", Icon: GridIcon },
];

function pageFromHash(): Page {
  const hash = window.location.hash.split("?")[0]; // "#/dca?new" opens the DCA wizard
  const found = [...PAGES, ...BOT_PAGES].find((p) => p.hash === hash);
  return found?.page ?? "dashboard";
}

// The panel's open or folded state is a per-browser convenience: storage may be blocked.
function readFolded(): boolean {
  try {
    return window.localStorage.getItem(FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveFolded(folded: boolean) {
  try {
    window.localStorage.setItem(FOLDED_KEY, folded ? "1" : "0");
  } catch {
    // Not kept: it opens unfolded next time.
  }
}

const BINANCE: Record<Status, { word: string; dot: string }> = {
  connected: { word: "Binance", dot: "" },
  demo: { word: "Binance demo", dot: "" },
  fetching: { word: "Binance", dot: "quiet" },
  disconnected: { word: "Binance disconnected", dot: "off" },
};

function taoPill(tao: TaoWallet["status"] | null): { word: string; dot: string; title: string } {
  if (tao === "connected") return { word: "Wallet", dot: "", title: "Read through Taostats" };
  if (tao === "error") return { word: "Wallet", dot: "off", title: "Taostats couldn't be read" };
  if (tao === "not_set")
    return { word: "No wallet", dot: "quiet", title: "Add TAO_COLDKEY to .env" };
  return { word: "Wallet", dot: "quiet", title: "Not read yet" };
}

function Logo() {
  // A rising candle over the desk's edge.
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <rect x="0.5" y="0.5" width="25" height="25" rx="7" className="g-panel" />
      <rect x="7" y="9" width="4" height="8" rx="1" className="g-accent" />
      <rect x="8.5" y="6" width="1" height="13" className="g-accent" />
      <rect x="15" y="12" width="4" height="5" rx="1" className="g-accent" opacity=".45" />
      <rect x="16.5" y="10" width="1" height="9" className="g-accent" opacity=".45" />
      <rect x="5" y="20" width="16" height="1.5" rx=".75" className="g-text" />
    </svg>
  );
}

// Binance's logo (BNB's) or the TAO logo for the wallet, from the api; a wallet glyph without it.
function PillLogo({ coin }: { coin: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="pill-icon">
      {failed ? (
        <WalletIcon />
      ) : (
        <img
          src={`/api/coin-icon/${coin}`}
          alt=""
          width={18}
          height={18}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [status, setStatus] = useState<Status>("fetching");
  const [tao, setTao] = useState<TaoWallet["status"] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [switching, setSwitching] = useState(false);
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [global, setGlobal] = useState<MarketGlobal | null>(null);
  const [total, setTotal] = useState<{ usd: string; rates: Record<string, string> } | null>(null);
  const [currency, setCurrency] = useState<Currency>(readCurrency);
  const [currencyMenu, setCurrencyMenu] = useState(false);
  const pickCurrency = (code: Currency) => {
    setCurrency(code);
    setCurrencyMenu(false);
    try {
      window.localStorage.setItem(CURRENCY_KEY, code);
    } catch {
      // private window: the choice lasts for this visit only
    }
  };
  const [folded, setFolded] = useState(readFolded);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const follow = () => {
      setPage(pageFromHash());
      setDrawer(false);
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  useEffect(() => {
    getSettings().then(setSettings, () => setSettings(null));
    const tick = () => {
      getTickers(["BTC"]).then(
        (r) => setTickers(r.tickers),
        () => setTickers([]),
      );
      getGlobal().then(setGlobal, () => setGlobal(null));
    };
    const sum = () =>
      getPortfolio().then(
        (p) => setTotal({ usd: p.total.value, rates: p.total.rates ?? {} }),
        () => setTotal(null),
      );
    tick();
    sum();
    const timer = window.setInterval(tick, TICK_MS);
    const slow = window.setInterval(sum, TOTAL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(slow);
    };
  }, []);

  const onStatus = useCallback((next: Status) => setStatus(next), []);
  const onTao = useCallback((next: TaoWallet["status"]) => setTao(next), []);
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

  const fold = () => {
    setFolded(!folded);
    saveFolded(!folded);
  };

  const link = ({ page: target, hash, name, Icon }: (typeof PAGES)[number]) => (
    <a
      key={target}
      href={hash}
      aria-current={page === target ? "page" : undefined}
      title={folded ? name : undefined}
    >
      <Icon />
      <span className="side-word">{name}</span>
    </a>
  );

  const binance = BINANCE[status];
  const wallet = taoPill(tao);
  const on = settings?.tradingOn ?? false;

  return (
    <div className={`app${folded ? " folded" : ""}${drawer ? " drawer" : ""}`}>
      <aside className="side" aria-label="Side panel">
        <div className="side-head">
          <a className="brand" href="#/">
            <Logo />
            <span className="side-word">trading-desk</span>
          </a>
        </div>
        {/* On the panel's edge, as Taostats has it: « folds, » opens. */}
        <button
          className="side-fold"
          type="button"
          onClick={fold}
          aria-label={folded ? "Expand side panel" : "Collapse side panel"}
          aria-expanded={!folded}
        >
          <CollapseIcon />
        </button>
        <nav className="side-nav" aria-label="Main">
          {PAGES.map(link)}
          <div className="side-rule" />
          <div className="side-label side-word">Bots</div>
          {BOT_PAGES.map(link)}
        </nav>
        <div className="side-status">
          <span className="pill" title={folded ? binance.word : undefined}>
            <PillLogo coin="BNB" />
            <span className="side-word">{binance.word}</span>
            <span className={`dot ${binance.dot}`} aria-hidden="true" />
          </span>
          <span className="pill" title={wallet.title}>
            <PillLogo coin="TAO" />
            <span className="side-word">{wallet.word}</span>
            <span className={`dot ${wallet.dot}`} aria-hidden="true" />
          </span>
          <button
            className="pill"
            type="button"
            aria-pressed={on}
            disabled={!settings || switching}
            onClick={toggle}
            title="Kill switch: off refuses every new order"
          >
            <span className="pill-icon">
              <PowerIcon />
            </span>
            <span className="side-word">
              {settings ? (on ? "Trading on" : "Trading off") : "Trading unknown"}
            </span>
            <span className={`dot ${on ? "" : "off"}`} aria-hidden="true" />
          </button>
        </div>
      </aside>
      <button
        className="side-scrim"
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={() => setDrawer(false)}
      />
      <div className="main">
        <header className="top">
          <button
            className="icon-btn menu-btn"
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
          >
            <MenuIcon />
          </button>
          <div className="spacer" />
          <div className="tickers num" aria-label="Market">
            {tickers.map((t) => (
              <a key={t.coin} className="tick" href="#/trade" title="Bitcoin's price">
                <span className="tick-coin">{t.coin}</span>
                <span>
                  <b>{price(t.price)}</b>{" "}
                  <span className={trend(t.change24h)}>{percent(t.change24h)}</span>
                </span>
              </a>
            ))}
            {global?.btcShare && (
              <span
                className="tick"
                title="Bitcoin's share of the whole market. Falling: money is moving into altcoins."
              >
                <span className="tick-coin">BTC dominance</span>
                <b>{Number(global.btcShare).toFixed(1)}%</b>
              </span>
            )}
            {global?.cap && (
              <span className="tick" title="The whole crypto market's size and its 24h change">
                <span className="tick-coin">Market cap</span>
                <span>
                  <b>{usdShort(global.cap)}</b>{" "}
                  <span className={trend(global.capChange ?? null)}>
                    {percent(global.capChange ?? null)}
                  </span>
                </span>
              </span>
            )}
          </div>
          {total && (
            <a className="head-total num" href="#/" aria-label="Total value">
              <WalletIcon />
              <span>
                <b>{money(currency, total.rates).whole(total.usd)}</b>
                <small>
                  ≈{" "}
                  {currency === "BTC"
                    ? money("AUD", total.rates).whole(total.usd)
                    : money("BTC", total.rates).whole(total.usd)}
                </small>
              </span>
            </a>
          )}
          <div className="currency-toggle">
            <button
              type="button"
              className="currency-btn"
              aria-haspopup="menu"
              aria-expanded={currencyMenu}
              aria-label={`Currency: ${currency}`}
              onClick={() => setCurrencyMenu(!currencyMenu)}
            >
              {currency} <span aria-hidden="true">▾</span>
            </button>
            {currencyMenu && (
              <div className="create-list currency-list" role="menu" aria-label="Currency">
                {CURRENCIES.map((code) => {
                  const known = code === "USD" || Boolean(total?.rates[code]);
                  return (
                    <button
                      key={code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={currency === code}
                      disabled={!known}
                      onClick={() => pickCurrency(code)}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </header>
        {page === "trade" ? (
          <Trade settings={settings} onSettings={onSettings} onStatus={onStatus} />
        ) : page === "dca" ? (
          <DcaBots />
        ) : page === "grid" ? (
          <GridBots />
        ) : (
          <Portfolio onStatus={onStatus} onTao={onTao} currency={currency} />
        )}
      </div>
    </div>
  );
}
