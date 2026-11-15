// The Trade page's left column (TODO 6): the watchlist, each coin with the agent's last call and
// how old it is, so the list doubles as an inbox. Analyse all ranks which coins need a full run.
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createWatchlist,
  deleteWatchlist,
  getWatchlist,
  unwatchCoin,
  watchCoin,
} from "./api";
import CoinIcon from "./CoinIcon";
import { ago, percent, price, trend, usd } from "./format";
import { actionTone } from "./TradeAgent";
import type { AgentCall, CoinRank, Watchlist } from "./types";

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

const PRIORITY: Record<CoinRank["priority"], string> = {
  high: "Run first",
  medium: "Worth a run",
  low: "Can wait",
};

export default function Coins({
  list,
  selected,
  calls,
  ranked,
  ranking,
  rankError,
  now,
  onSelect,
  onChange,
  onRank,
}: {
  list: Watchlist | null;
  selected: string;
  calls: AgentCall[];
  ranked: { ranked: CoinRank[]; cost: string } | null;
  ranking: boolean;
  rankError: string;
  now: number;
  onSelect: (coin: string) => void;
  onChange: (next: Watchlist, added?: string) => void;
  onRank: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [menu]);
  const listId = list?.list.id ?? 0;

  const settle = (pending: Promise<Watchlist>, after?: (next: Watchlist) => void) => {
    setError("");
    pending.then(
      (next) => {
        if (after) after(next);
        else onChange(next);
      },
      (err: unknown) => setError(message(err)),
    );
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    const coin = typed.trim().toUpperCase();
    if (!coin || !listId) return;
    settle(watchCoin(coin, listId), (next) => {
      setTyped("");
      onChange(next, coin.replace(/(USDT|USDC|FDUSD)$/, ""));
    });
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    settle(createWatchlist(newName), (next) => {
      setNaming(false);
      setNewName("");
      onChange(next);
    });
  };
  const drop = () =>
    settle(deleteWatchlist(listId), (next) => {
      setDropping(false);
      onChange(next);
    });

  return (
    <aside className="tr-col tr-coins" aria-label="Coins">
      <div className="tr-coins-head" ref={menuBox}>
        <button
          type="button"
          className="tr-list-name"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          {list?.list.name ?? "Coins"} <span aria-hidden="true">▾</span>
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={!list?.coins.length || ranking}
          title="A quick pass that ranks which coins need a full run"
          onClick={onRank}
        >
          {ranking ? "Ranking…" : "Analyse all"}
        </button>
        {menu && (
          <div className="create-list tr-menu" role="menu" aria-label="Watchlists">
            {list?.lists.map((l) => (
              <button
                key={l.id}
                type="button"
                role="menuitem"
                className={l.id === listId ? "on" : ""}
                onClick={() => {
                  setMenu(false);
                  setEditing(false);
                  settle(getWatchlist(l.id));
                }}
              >
                {l.name}
                <span className="muted">{l.count}</span>
              </button>
            ))}
            <hr />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setEditing(true);
              }}
            >
              Edit {list?.list.name ?? "list"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setNaming(true);
              }}
            >
              New list
            </button>
            {list && list.lists.length > 1 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setDropping(true);
                }}
              >
                Delete {list.list.name}
              </button>
            )}
          </div>
        )}
      </div>
      {naming && (
        <form className="tr-add" onSubmit={create}>
          <label htmlFor="tr-list-name" className="visually-hidden">
            New watchlist name
          </label>
          <input
            id="tr-list-name"
            placeholder="Name, e.g. Memes"
            autoComplete="off"
            maxLength={30}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn btn-small" type="submit">
            Create
          </button>
          <button className="link" type="button" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </form>
      )}
      {dropping && list && (
        <p className="tr-note">
          Delete {list.list.name}?{" "}
          <button className="link" type="button" onClick={drop}>
            Delete
          </button>{" "}
          <button className="link" type="button" onClick={() => setDropping(false)}>
            Keep
          </button>
        </p>
      )}
      {editing && (
        <>
          <form className="tr-add" onSubmit={add}>
            <label htmlFor="tr-add-coin" className="visually-hidden">
              Add coin
            </label>
            <input
              id="tr-add-coin"
              placeholder="Add a coin, e.g. AVAX"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button className="btn btn-small" type="submit">
              Add
            </button>
          </form>
          <div className="tr-note tr-meta muted">
            <span>{list ? `${list.coins.length} of ${list.max} coins` : ""}</span>
            <button className="link" type="button" onClick={() => setEditing(false)}>
              Done
            </button>
          </div>
        </>
      )}
      {(error || rankError) && (
        <p className="tr-note down" role="alert">
          {error || rankError}
        </p>
      )}
      {!list && !error && (
        <div className="tr-note" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton tr-coin-skeleton" />
          ))}
        </div>
      )}
      {list && list.coins.length === 0 && (
        <p className="tr-note muted">
          No coins in {list.list.name}. Open the list&apos;s menu and choose Edit to add one.
        </p>
      )}
      <ul className="tr-coin-list">
        {list?.coins.map((c) => {
          const call = calls.find((k) => k.coin === c.coin);
          const rank = ranked?.ranked.find((r) => r.coin === c.coin);
          const on = c.coin === selected;
          return (
            <li key={c.coin} className={on ? "on" : ""}>
              <button
                className="tr-coin"
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => onSelect(c.coin)}
              >
                <span className="coin">
                  <CoinIcon coin={c.coin} />
                </span>
                <span className="tr-coin-name">
                  <b>{c.coin}</b>
                  <span className="num muted">
                    {price(c.price)}{" "}
                    <span className={trend(c.change24h)}>{percent(c.change24h)}</span>
                  </span>
                  {rank && (
                    <span className="tr-reason dim" title={rank.reason}>
                      {rank.reason}
                    </span>
                  )}
                </span>
                <span className="tr-call">
                  {call ? (
                    <>
                      <span className={`tag ${actionTone(call.action)}`}>{call.action}</span>
                      <span className={call.outOfDate ? "wait" : "dim"}>
                        {call.outOfDate ? "Out of date" : ago(call.ranAt, now)}
                      </span>
                    </>
                  ) : (
                    <span className="dim">No call yet</span>
                  )}
                  {rank && (
                    <span className={`tr-prio ${rank.priority}`}>{PRIORITY[rank.priority]}</span>
                  )}
                </span>
              </button>
              {editing && (
                <button
                  className="tr-rm"
                  type="button"
                  aria-label={`Remove ${c.coin}`}
                  onClick={() => settle(unwatchCoin(c.coin, listId))}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="tr-coins-foot">
        {ranked
          ? `Ranked for $${ranked.cost}. Start with the coins marked Run first.`
          : "Analyse all ranks which coins need a full run, for about a cent."}
        {list && (
          <span>
            AI spend this month: {usd(list.aiBudget.spent)} of {usd(list.aiBudget.cap)}
          </span>
        )}
      </div>
    </aside>
  );
}
