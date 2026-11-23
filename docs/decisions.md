# Decisions

The decisions in force, newest last, one line each; the full record (date, why, instead of) is in the linked file. A superseded decision keeps its number as a pointer, so citations still work.

Decisions 1 to 32: [decisions/index-01-32.md](decisions/index-01-32.md). Decisions 33 to 57: [decisions/index-33-57.md](decisions/index-33-57.md). Decisions 58 to 80: [decisions/index-58-80.md](decisions/index-58-80.md).

To add one: its line here, and its record, in the same form, at the end of the newest file in [decisions/](decisions/) (a new file past about 2,000 words).

81. trading-agent.md is the one strategy record, each style Built and Not built yet; every version kept; the daily scan is swing, plus position on Mondays. [Record](decisions/from-58.md)
82. The odds check: each pick's rule re-run on past candles and simulated from them, a warning not a gate; the record decides once it has 8 decided signals. [Record](decisions/from-58.md)
83. Freqtrade 2026.10 backtests and paper-trades the styles, calling the desk's own screener rule; it never trades, the desk keeps placing orders. [Record](decisions/from-58.md)
84. The AI parts: FreqAI filters setups in backtests; trading-agent judges only in paper trading, through a new single-setup endpoint the paper container may call by service name. [Record](decisions/from-58.md)
85. Feature flags: one registry of the desk's pages and features, each switched on or off in Settings, kept in the api's store; off only hides and skips loading; new features arrive off. [Record](decisions/from-58.md)
86. An exit Binance refuses with the price already past the stop or target sells the rest at market, once per try; the Trade page audit's other fixes. [Record](decisions/from-58.md)
87. The Backtest page: a type, one top-100 USDC coin, up to 3 months, run by an always-on Freqtrade worker via a file queue (no Docker socket or webserver); only the desk's runs listed. [Record](decisions/from-58.md)
88. Scan now runs all four styles, a card each (take, closest, or nothing near); the daily scan stays swing and position, so its AI cost holds. [Record](decisions/from-58.md)
89. Each style's unbuilt exits backtested with Freqtrade's callbacks beside the plain style; NostalgiaForInfinity X8 as a benchmark, downloaded at a pinned release, never committed; BTC-only runs. [Record](decisions/from-58.md)
90. The DCA close-out keeps open limits open unless the owner chooses; every DCA buy counts toward its week, and Buy the rest buys the plan's unplaced share too. [Record](decisions/from-58.md)
91. Exits outside Binance's price band: the stop is watched or placed alone, the rest once in range. [Record](decisions/from-58.md)
92. Keep as a holding moves a trade's coins out unsold; risk 2% a trade, open risk 6%. [Record](decisions/from-58.md)
93. No stop wider than Binance holds: capped at 18% under entry, refused outside the pair's band. [Record](decisions/from-58.md)
94. Hold with no stop: a trade stays in Positions with no exits until a stop is set. [Record](decisions/from-58.md)
95. trading-agent judges the near misses too, watch only: Wait or Pass, never Take; "Near" tags gone. [Record](decisions/from-58.md)
96. The DCA plan is a running total; Monday buys what has no order yet and limits a week old, within free USDC that isn't the Trading account's. [Record](decisions/from-58.md)
97. The owner's own trades warn past the account's soft rules; no cap on the Trading account; ladders with optional stops; the scan reads macro, mood and dominance as context. [Record](decisions/from-58.md)
98. Old smart trades deleted; the Trading account trades. [Record](decisions/from-58.md)
99. The TAO wallet becomes the Ledger: TAO by Taostats, the other coins by public address (Solana, Ethereum, HyperEVM, Sui, NEAR, Bitcoin by xpub); moved coins keep their Binance cost. [Record](decisions/from-58.md)
100. Tax gets its own page: FY gains, lots and the 12-month countdown moved from the Portfolio, plus a staking income log. [Record](decisions/from-58.md)
101. The Portfolio is three tabs (All, Binance, Ledger), each with four widgets, an Allocation donut, and Fiat on Binance only. [Record](decisions/from-58.md)
102. The subscription's usage: the plan's windows shown for the whole account as last read on a desk run, this app's own runs in tokens and API-equivalent dollars; the API key's runs and spend against the cap. [Record](decisions/from-58.md)
103. Claude on GitHub: `@claude` answers and may push to PR branches as `claude[bot]`; Claude reviews each PR when it opens. [Record](decisions/from-58.md)
