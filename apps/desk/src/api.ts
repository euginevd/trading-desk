import type { Portfolio, Settings, SmartTrade, SmartTradeRequest, Terminal } from "./types";

export class ApiError extends Error {}

// The one place that reaches the api (code-standards 4); the dev server proxies /api to it.
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("The desk's api isn't running. Start it, then try again.");
  }
  const reply: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      reply && typeof reply === "object" && "error" in reply
        ? String(reply.error)
        : "The api couldn't answer. Check it's running, then try again.";
    throw new ApiError(message);
  }
  return reply as T;
}

export const getPortfolio = () => call<Portfolio>("GET", "/portfolio");
export const getTerminal = (symbol: string) =>
  call<Terminal>("GET", `/trade?symbol=${encodeURIComponent(symbol)}`);
export const getSettings = () => call<Settings>("GET", "/settings");
export const setTrading = (on: boolean) => call<Settings>("PUT", "/trading", { on });
export const setLimits = (perOrder: string, perDay: string) =>
  call<Settings>("PUT", "/limits", { perOrder, perDay });
export const placeTrade = (request: SmartTradeRequest) =>
  call<SmartTrade>("POST", "/trades", request);
export const cancelTrade = (id: number) => call<SmartTrade>("POST", `/trades/${id}/cancel`, {});
export const closeTrade = (id: number) => call<SmartTrade>("POST", `/trades/${id}/close`, {});
