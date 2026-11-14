# Trust boundaries in full

The detail behind [threat-model.md](../threat-model.md)'s trust boundaries and its data flow.

- **TB1** Browser to `api`: both containers publish on `127.0.0.1` only, so only the owner's machine reaches them. There's no sign-in (decision 10), so any process or web page on the machine is a possible caller: the `api` allows only the desk's origin and checks `Content-Type` on every write.
- **TB2** `api` to Binance and Frankfurter: over TLS; Binance calls are signed. What comes back is untrusted, parsed against a fixed shape and shown as text.
- **TB3** `api` to Taostats: over TLS, sending only the public address.
- **Binance deposit history** (decision 31): the api reads the USDC deposit history with the same read-only key, and keeps what the owner paid per deposit in the local SQLite under `local/`, git-ignored. The owner's figures never go in tests, demo data or docs ([known-mistakes 7](../known-mistakes.md)).
- **Fear & Greed Index** (decision 36): the api asks `api.alternative.me` for the index, with no account data, at most every 10 minutes, and checks the value is 0 to 100.
- **Fear & Greed details and market size** (decision 42): the api asks `api.alternative.me` for a year of the index and CoinGecko's `/global` for the market's size, volume and dominance (also for the header, decision 44), with no account data, kept 10 minutes; what comes back is checked and shown as numbers and fixed words.
- **TB5** `api` to CoinGecko: sends a coin's ticker once to find its logo, so CoinGecko can see which coins the desk shows, never amounts. Logos are taken only from CoinGecko's image host, only as PNG, JPEG or WebP (never SVG), up to 256 KB, and kept in `local/icons/`. Each portfolio refresh also asks CoinGecko for USDT's price in AUD and INR (decisions 29, 30): no account data is sent, and a reply outside 0.8 to 3 is ignored for the ECB's rate.
- **TB4** `api` to Anthropic: sends a coin's computed figures and the owner's position in it (amount, average cost, PnL, share, cash, the portfolio's total value, open orders' side, price and amount: decision 46), never keys, account ids or order ids. What comes back, including text from web pages it searched, is untrusted: checked against a fixed shape and shown as text.
