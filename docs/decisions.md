# Decisions

The decisions in force, newest last, one line each; the full record (date, why, instead of) is in the linked file. A superseded decision keeps its number as a pointer, so citations still work.

Decisions 1 to 32: [decisions/index-01-32.md](decisions/index-01-32.md). Decisions 33 to 57: [decisions/index-33-57.md](decisions/index-33-57.md).

To add one: its line here, and its record, in the same form, at the end of the newest file in [decisions/](decisions/) (a new file past about 2,000 words).

58. The Profile is the owner's Investment Policy Statement: typed, versioned, read by every agent; unset rules are never enforced. [Record](decisions/from-58.md)
59. *Superseded by 70:* The agents are a team of five under a Desk Coordinator, each with a name, title and remit. [Record](decisions/from-58.md)
60. A trading agent with a versioned profile; Analyse runs one coin step by step and proposes an order; Trade rebuilt around it. [Record](decisions/from-58.md)
61. *Partly superseded by 70 (trade.md):* profile.md and trade.md are the source, changed through Claude Code; the desk renders them read-only. [Record](decisions/from-58.md)
62. profile.md v2 is the Profile word for word; four widgets from it; the command bar changes it through a diff and Accept. [Record](decisions/from-58.md)
63. The Dashboard as the morning check: the day in a sentence, a week rail of the plan's buys, what to watch. [Record](decisions/from-58.md)
64. The Portfolio as what you hold in a sentence and one strip against targets; Fear & Greed in the top bar; a real kill switch. [Record](decisions/from-58.md)
65. Settings as a sentence and hairline sections; the name only from the Profile; each fact on one page. [Record](decisions/from-58.md)
66. The Journal as a sentence of rules kept, a 30-day strip of trades, then the filtered ledger. [Record](decisions/from-58.md)
67. *Superseded by 69:* Trade leads with the agent's call; the steps fold away; the levels are a ladder around today's price. [Record](decisions/from-58.md)
68. DCA and Grid bots share one Bots page, filtered by type; the old links open it filtered. [Record](decisions/from-58.md)
69. Trade keeps only what you can act on: verdict, one line on what to do, the order and its checks; reasons fold away. [Record](decisions/from-58.md)
70. My agents: one versioned Markdown file per agent in `local/agents/`, on a week rota on the Profile; the first is `dca-agent`. [Record](decisions/from-58.md)
71. The monthly money splits into DCA and a small trading pot, one agent each; bot styles are playbooks in the trading agent's file. [Record](decisions/from-58.md)
72. The DCA book: one lifelong position per coin, fed only from the desk, P&L against money added; the desk works out fill odds. [Record](decisions/from-58.md)
73. The trading pot is its own book run by trading-agent: POT- rows for money in, a lifelong TRD- reference per trade, stop and target as one OCO. [Record](decisions/from-58.md)
74. A scheduler (plain code) wakes the agents once per slot and brings proposals to Telegram with one-tap buttons that run the desk's checks. [Record](decisions/from-58.md)
75. The trading pot is the Trading account: money first, coins as cards, trades in tabs; other buys dipping into its USDC are logged, not blocked. [Record](decisions/from-58.md)
76. A visual refresh: ink-blue surfaces, a serif for the desk's sentences, a top-edge sheen on raised controls, one settle-in motion. [Record](decisions/from-58.md)
77. The teal floating console: a rounded frame, layered panels, pill tabs with icons, one type scale with nothing under 12px to read. [Record](decisions/from-58.md)
78. The Ledger mark; a slow ambient drift behind the frame; the Trading account's trades take the Profile pre-trade check. [Record](decisions/from-58.md)
79. Risk leads with four risks: A$10K on Binance in all, 70%+ of the 2026 coins on the Ledger, TAO's glide path, the backup checks. [Record](decisions/from-58.md)
80. New trade by style: a screener in code over the top 100 on Binance, trading-agent on the shortlist only; scalp and day trades on test. [Record](decisions/from-58.md)
81. trading-agent.md is the one strategy record, each style Built and Not built yet; every version kept; the daily scan is swing, plus position on Mondays. [Record](decisions/from-58.md)
82. The odds check: each pick's rule re-run on past candles and simulated from them, a warning not a gate; the record decides once it has 8 decided signals. [Record](decisions/from-58.md)
83. Freqtrade 2026.10 backtests and paper-trades the styles, calling the desk's own screener rule; it never trades, the desk keeps placing orders. [Record](decisions/from-58.md)
84. The AI parts: FreqAI filters setups in backtests; trading-agent judges only in paper trading, through a new single-setup endpoint the paper container may call by service name. [Record](decisions/from-58.md)
85. Feature flags: one registry of the desk's pages and features, each switched on or off in Settings, kept in the api's store; off only hides and skips loading; new features arrive off. [Record](decisions/from-58.md)
86. An exit Binance refuses with the price already past the stop or target sells the rest at market, once per try; the Trade page audit's other fixes. [Record](decisions/from-58.md)
87. The Backtest page: a type, one top-100 USDC coin and up to 3 months, run by an always-on Freqtrade worker through a file queue, not the Docker socket or Freqtrade's webserver; only the desk's own runs listed. [Record](decisions/from-58.md)
88. Scan now runs all four styles, a card each (take, closest, or nothing near); the daily scan stays swing and position, so its AI cost holds. [Record](decisions/from-58.md)
89. Each style's Not built yet exits tested in the backtest with Freqtrade's own callbacks, beside the plain style; NostalgiaForInfinity X8 as a benchmark, downloaded at a pinned release, never committed; BTC-only runs. [Record](decisions/from-58.md)
91. Exits Binance won't take yet (a stop over 20% under the price, a target over twice it): the desk watches the stop itself, or places the stop alone, and adds the rest once in range; the Positions row says which. [Record](decisions/from-58.md)
