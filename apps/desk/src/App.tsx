import DcaBookPage from "./DcaBookPage";
import "./dca.css";
import { useCallback, useEffect, useState } from "react";
import { getGlobal, getPortfolio, getSentiment, getSettings, getTickers, setTrading } from "./api";
import { percent, trend, usdShort } from "./format";
import Coach from "./Coach";
import Journal from "./Journal";
import BotsPage, { type BotKind } from "./BotsPage";
import SettingsPage from "./SettingsPage";
import {
  CollapseIcon,
  DashboardIcon,
  DcaIcon,
  JournalIcon,
  MenuIcon,
  PlanIcon,
  PortfolioIcon,
  PowerIcon,
  SettingsIcon,
  TradeIcon,
  WalletIcon,
} from "./icons";
import ProfilePage from "./ProfilePage";
import Portfolio from "./Portfolio";
import { CURRENCIES, type Currency, money } from "./money";
import PotPage from "./PotPage";
import type { MarketGlobal, Sentiment, Settings, TaoWallet, Ticker } from "./types";
import { FearPanel } from "./WidgetDetails";
import type { Status } from "./ui";

type Page =
  "dashboard" | "profile" | "portfolio" | "journal" | "trade" | "bots" | "settings" | "dca-book";
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
  { page: "portfolio", hash: "#/portfolio", name: "Portfolio", Icon: PortfolioIcon },
  { page: "journal", hash: "#/journal", name: "Journal", Icon: JournalIcon },
  { page: "trade", hash: "#/trade", name: "Trade", Icon: TradeIcon },
];
// DCA and grid bots share one page (decision 68); the old links open it filtered.
const BOTS_PAGE: (typeof PAGES)[number] = {
  page: "bots",
  hash: "#/bots",
  name: "Bots",
  Icon: DcaIcon,
};
const OLD_BOT_LINKS: Record<string, BotKind> = { "#/dca": "dca", "#/grid": "grid" };

function botKindFromHash(): BotKind {
  const [path, query] = window.location.hash.split("?");
  return (
    OLD_BOT_LINKS[path ?? ""] ??
    (query === "dca" || query === "grid" || query === "rebalance" ? query : "all")
  );
}
const PROFILE_PAGE: (typeof PAGES)[number] = {
  page: "profile",
  hash: "#/profile",
  name: "Profile",
  Icon: PlanIcon,
};
const SETTINGS_PAGE: (typeof PAGES)[number] = {
  page: "settings",
  hash: "#/settings",
  name: "Settings",
  Icon: SettingsIcon,
};

function pageFromHash(): Page {
  const hash = window.location.hash.split("?")[0] ?? "";
  if (hash in OLD_BOT_LINKS) return "bots";
  if (hash === "#/dca-book") return "dca-book"; // reached from the Dashboard's DCA widget
  const found = [...PAGES, BOTS_PAGE, PROFILE_PAGE, SETTINGS_PAGE].find((p) => p.hash === hash);
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

// BTC dominance's move over 24 hours, in percentage points. CoinGecko gives today's share only, so
// a day ago is worked out: the share times the market's growth over Bitcoin's (its price change
// stands in for its market cap's, the supply barely moving in a day). Null without both.
export function dominanceMove(global: MarketGlobal | null, tickers: Ticker[]): number | null {
  const btc = tickers.find((t) => t.coin === "BTC")?.change24h;
  if (!global?.btcShare || global.capChange === undefined || btc === null || btc === undefined)
    return null;
  const share = Number(global.btcShare);
  const before = (share * (1 + Number(global.capChange) / 100)) / (1 + Number(btc) / 100);
  return share - before;
}

// The index's mood, as the Dashboard's colours: fear red, greed green, neutral amber.
function fearMood(value: number): string {
  if (value < 45) return "down";
  return value > 55 ? "up" : "wait";
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
  const [botKind, setBotKind] = useState<BotKind>(botKindFromHash);
  const [status, setStatus] = useState<Status>("fetching");
  const [tao, setTao] = useState<TaoWallet["status"] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [switching, setSwitching] = useState(false);
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [global, setGlobal] = useState<MarketGlobal | null>(null);
  const [fear, setFear] = useState<Sentiment | null>(null);
  const [fearAt, setFearAt] = useState<DOMRect | null>(null);
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
      setBotKind(botKindFromHash());
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
    const mood = () => getSentiment().then(setFear, () => setFear(null));
    const sum = () =>
      getPortfolio().then(
        (p) => {
          setTotal({ usd: p.total.value, rates: p.total.rates ?? {} });
          // The side panel's pills, whichever page is open (the coach doesn't read balances).
          setStatus(p.demo ? "demo" : "connected");
          setTao(p.wallets.tao.status);
        },
        () => {
          setTotal(null);
          setStatus("disconnected");
        },
      );
    tick();
    sum();
    mood();
    const timer = window.setInterval(tick, TICK_MS);
    const slow = window.setInterval(() => {
      sum();
      mood();
    }, TOTAL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(slow);
    };
  }, []);

  const onStatus = useCallback((next: Status) => setStatus(next), []);
  const onTao = useCallback((next: TaoWallet["status"]) => setTao(next), []);

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
          {link(BOTS_PAGE)}
          <div className="side-rule" />
          {link(PROFILE_PAGE)}
          {link(SETTINGS_PAGE)}
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
            className="pill kill"
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
            <span className={`switch${on ? " on" : ""}`} aria-hidden="true">
              <i />
            </span>
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
          <div className="tickers num" aria-label="Market">
            {tickers.map((t) => (
              <a key={t.coin} className="tick" href="#/trade" title="Bitcoin's price">
                <span className="tick-coin">{t.coin}</span>
                <span>
                  <b>{Math.round(Number(t.price)).toLocaleString("en-AU")}</b>{" "}
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
                <span>
                  <b>{Number(global.btcShare).toFixed(1)}%</b>{" "}
                  {(() => {
                    const moved = dominanceMove(global, tickers);
                    return moved === null ? null : (
                      <span className={trend(String(moved))}>
                        {moved > 0 ? "+" : moved < 0 ? "−" : ""}
                        {Math.abs(moved).toFixed(1)}%
                      </span>
                    );
                  })()}
                </span>
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
            {fear && (
              <button
                type="button"
                className={`tick tick-fear ${fearMood(fear.value)}`}
                aria-label={`Fear & Greed ${fear.value}, ${fear.label}: details`}
                onClick={(e) => setFearAt(e.currentTarget.getBoundingClientRect())}
              >
                <span className="tick-coin">Fear &amp; Greed</span>
                <span>
                  <b>{fear.value}</b> <span className="tick-mood">{fear.label}</span>
                </span>
              </button>
            )}
          </div>
          <FearPanel at={fearAt} onClose={() => setFearAt(null)} />
          <div className="spacer" />
          {total && (
            <a
              className="head-total num"
              href="#/portfolio"
              aria-label="Total value"
              title="Your Portfolio"
            >
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
          <PotPage />
        ) : page === "bots" ? (
          <BotsPage
            kind={botKind}
            onKind={(k) => {
              window.location.hash = k === "all" ? "#/bots" : `#/bots?${k}`;
            }}
          />
        ) : page === "dca-book" ? (
          <DcaBookPage />
        ) : page === "settings" ? (
          <SettingsPage />
        ) : page === "profile" ? (
          <ProfilePage />
        ) : page === "journal" ? (
          <Journal />
        ) : page === "portfolio" ? (
          <Portfolio onStatus={onStatus} onTao={onTao} currency={currency} />
        ) : (
          <Coach />
        )}
      </div>
    </div>
  );
}
