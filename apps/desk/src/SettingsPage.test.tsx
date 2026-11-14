import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSettings } from "./types";

const saved: AiSettings = {
  mode: "api_key",
  fallback: false,
  apiKeySet: true,
  tokenSet: false,
  model: "claude-opus-5-5",
  budget: { spent: "4.1", cap: "20" },
};

const setAiSettings = vi.fn((mode: AiSettings["mode"], fallback: boolean) =>
  Promise.resolve({ ...saved, mode, fallback }),
);
vi.mock("./api", () => ({
  getAiSettings: () => Promise.resolve(saved),
  setAiSettings: (mode: AiSettings["mode"], fallback: boolean) => setAiSettings(mode, fallback),
}));

const { default: SettingsPage } = await import("./SettingsPage");

afterEach(cleanup);

describe("Settings", () => {
  it("shows the AI choice, whether each credential is set and how to get it", async () => {
    render(<SettingsPage />);
    const key = await screen.findByRole("button", { name: "API key (pay per use)" });
    expect(key.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/ANTHROPIC_API_KEY is set/)).toBeTruthy();
    expect(screen.getByText(/\$4\.1 of \$20 this month/)).toBeTruthy();
    expect(screen.getByText(/CLAUDE_CODE_OAUTH_TOKEN isn't set/)).toBeTruthy();
    expect(screen.getByText(/claude setup-token/)).toBeTruthy();
    expect(screen.getByText(/console\.anthropic\.com/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("switches to the subscription and offers the fall back", async () => {
    render(<SettingsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Claude subscription (personal use)" }),
    );
    expect(setAiSettings).toHaveBeenCalledWith("subscription", false);
    const fallback = await screen.findByRole("checkbox", {
      name: "Use the API key if the subscription fails",
    });
    fireEvent.click(fallback);
    expect(setAiSettings).toHaveBeenLastCalledWith("subscription", true);
  });
});
