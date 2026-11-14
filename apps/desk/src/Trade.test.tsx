import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Trade from "./Trade";
import type { Settings, Terminal } from "./types";

const limits: Settings = {
  tradingOn: true,
  perOrder: "100",
  perDay: "500",
  spentToday: "0",
  leftToday: "500",
};

function terminal(settings: Settings): Terminal {
  return {
    symbol: "BTCUSDT",
    pair: "BTC/USDT",
    pairs: [{ symbol: "BTCUSDT", pair: "BTC/USDT" }],
    price: "98420",
    change24h: "2.1",
    base: "BTC",
    quoteFree: "6292.15",
    baseFree: "0.4125",
    step: "0.00001",
    tick: "0.01",
    minOrder: "5",
    settings,
    trades: [
      {
        id: 1,
        created: 1_794_000_000_000,
        pair: "SOL/USDT",
        entry: "market",
        entryPrice: "212.4",
        amount: "0.47",
        spend: "99.83",
        takeProfit: "225",
        stopLoss: "205",
        status: "protected",
        exitPrice: null,
        profit: "0.8",
        note: null,
      },
    ],
  };
}

function serve(settings: Settings) {
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    const body = init?.method === "POST" ? { id: 2 } : terminal(settings);
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function show(settings: Settings | null) {
  render(<Trade settings={settings} onSettings={() => undefined} onStatus={() => undefined} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("trade terminal", () => {
  it("won't send anything until both limits are set", async () => {
    const unset = { ...limits, perOrder: "0", perDay: "0", leftToday: "0" };
    serve(unset);
    show(unset);
    expect(await screen.findByText("Set your limits to trade")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Set your limits first" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("won't send anything while the kill switch is off", async () => {
    const off = { ...limits, tradingOn: false };
    serve(off);
    show(off);
    const button = await screen.findByRole("button", { name: "Trading is off" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("states the trade in words, then sends it once with a request id", async () => {
    const fetch = serve(limits);
    show(limits);
    fireEvent.change(await screen.findByLabelText("Spend"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Review smart trade" }));
    expect(screen.getByText(/Buy about 0.00101 BTC at market for \$100.00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place smart trade" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/sent/));
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    const sent = JSON.parse(String(posts[0]?.[1]?.body)) as Record<string, string>;
    expect(sent.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.takeProfit).toBe("101372.60");
    expect(sent.stopLoss).toBe("96451.60");
  });

  it("asks before closing a trade at market", async () => {
    serve(limits);
    show(limits);
    fireEvent.click(await screen.findByRole("button", { name: "Close at market" }));
    expect(screen.getByText("Sell all at market?")).toBeTruthy();
    expect(screen.getByText("Protected")).toBeTruthy();
  });
});
