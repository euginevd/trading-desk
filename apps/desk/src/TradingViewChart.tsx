// TradingView's Advanced Chart widget (free embed, decision 22): the full TradingView chart, with
// its own data, indicators and drawing tools.
//
// It's framed straight from TradingView's widget site, the same page their embed script builds,
// so no TradingView script runs on the desk's origin: the browser keeps the frame apart from
// this page, the desk's api and your orders (threat model R11).

const WIDGET = "https://www.tradingview-widget.com/embed-widget/advanced-chart/";

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function widgetUrl(symbol: string, bg: string, grid: string): string {
  const config = {
    autosize: true,
    symbol,
    interval: "240",
    timezone: "Australia/Sydney",
    theme: "dark",
    style: "1",
    locale: "en",
    backgroundColor: bg,
    gridColor: grid,
    withdateranges: true,
    hide_side_toolbar: false,
    hide_volume: true, // the owner's choice: price only; add Volume back from Indicators
    allow_symbol_change: false,
    details: true,
    calendar: false,
    width: "100%",
    height: "100%",
  };
  return `${WIDGET}?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
}

export default function TradingViewChart({ symbol, pair }: { symbol: string; pair: string }) {
  const url = widgetUrl(`BINANCE:${symbol}`, token("--bg", "#0a0f12"), token("--line", "#1b272d"));
  return (
    <iframe
      className="tv-chart"
      title={`TradingView chart of ${pair}`}
      src={url}
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  );
}
