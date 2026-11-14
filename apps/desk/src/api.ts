import type { Portfolio } from "./types";

export class ApiError extends Error {}

// The one place that reaches the api (code-standards 4); the dev server proxies /api to it.
export async function getPortfolio(): Promise<Portfolio> {
  let response: Response;
  try {
    response = await fetch("/api/portfolio");
  } catch {
    throw new ApiError("The desk's api isn't running. Start it, then try again.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : "The api couldn't answer. Check it's running, then try again.";
    throw new ApiError(message);
  }
  return body as Portfolio;
}
