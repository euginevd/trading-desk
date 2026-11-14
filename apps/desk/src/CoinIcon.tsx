import { useState } from "react";

// A coin's own logo, served by the api from local/icons (decision 25); its letters until
// the logo loads, or when there's none.
export default function CoinIcon({ coin }: { coin: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <i aria-hidden="true">
      {failed ? (
        coin.slice(0, 4)
      ) : (
        <img
          src={`/api/coin-icon/${encodeURIComponent(coin)}`}
          alt=""
          width={24}
          height={24}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </i>
  );
}
