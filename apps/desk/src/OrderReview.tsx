// The review before anything reaches Binance (TODO 11): one line per order (coin, buy or sell,
// limit, amount, fill odds), then the total. Shared by Add funds, the week's planner and
// dca-agent's chat, so every confirm reads the same.
import CoinIcon from "./CoinIcon";
import { limit, two } from "./dcaFormat";

export type ReviewItem = {
  coin: string;
  action: "Buy" | "Sell" | "Change" | "Cancel";
  price: string;
  usdc: string;
  was?: string | null;
  odds?: number | null;
};

export default function OrderReview({
  items,
  quote,
  note,
}: {
  items: ReviewItem[];
  quote: string;
  note: string;
}) {
  const total = items
    .filter((i) => i.action !== "Cancel")
    .reduce((s, i) => s + (Number(i.usdc) || 0), 0);
  return (
    <div className="dcr">
      <ul aria-label="Orders to place">
        {items.map((i) => (
          <li key={`${i.action}-${i.coin}-${i.price}`}>
            <span className={`dcc-type is-${i.action.toLowerCase()}`}>{i.action}</span>
            <span className="dcb-coin">
              <CoinIcon coin={i.coin} />
              {i.coin}
            </span>
            <span className="num dcr-price">
              {i.was ? <span className="muted">{limit(i.was)} → </span> : null}
              {i.action === "Cancel" ? limit(i.was ?? i.price) : limit(i.price)}
            </span>
            <span className="num dcr-usdc">{two(i.usdc)}</span>
            <span className="num dcr-odds">
              {i.odds === null || i.odds === undefined ? "" : `${i.odds}%`}
            </span>
          </li>
        ))}
      </ul>
      <p className="dcr-total">
        <span>Total</span>
        <b className="num">
          {two(total)} {quote}
        </b>
      </p>
      <p className="muted dcr-note">{note}</p>
    </div>
  );
}
