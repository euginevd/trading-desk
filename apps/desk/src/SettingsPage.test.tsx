import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSettings } from "./types";

const saved: AiSettings = {
  mode: "api_key",
  fallback: false,
  apiKeySet: false,
  tokenSet: false,
  model: "claude-opus-5-5",
  budget: { spent: "4.1", cap: "20" },
};
const LINK = "https://claude.com/cai/oauth/authorize?code=true";

const setAiSettings = vi.fn((mode: AiSettings["mode"], fallback: boolean) =>
  Promise.resolve({ ...saved, mode, fallback }),
);
const saveAiKey = vi.fn((key: string) => key && Promise.resolve({ ...saved, apiKeySet: true }));
const startSignIn = vi.fn(() => Promise.resolve({ url: LINK }));
const finishSignIn = vi.fn((code: string) => code && Promise.resolve({ ...saved, tokenSet: true }));
vi.mock("./api", () => ({
  getAiSettings: () => Promise.resolve(saved),
  setAiSettings: (mode: AiSettings["mode"], fallback: boolean) => setAiSettings(mode, fallback),
  saveAiKey: (key: string) => saveAiKey(key),
  startSignIn: () => startSignIn(),
  finishSignIn: (code: string) => finishSignIn(code),
}));

const { default: SettingsPage } = await import("./SettingsPage");

afterEach(cleanup);

describe("Settings", () => {
  it("switches to the subscription and offers the fall back", async () => {
    render(<SettingsPage />);
    const key = await screen.findByRole("button", { name: "API key (pay per use)" });
    expect(key.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Claude subscription (personal use)" }));
    expect(setAiSettings).toHaveBeenCalledWith("subscription", false);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Use the API key if the subscription fails" }),
    );
    expect(setAiSettings).toHaveBeenLastCalledWith("subscription", true);
  });

  it("saves a pasted API key, then shows only that it's set", async () => {
    render(<SettingsPage />);
    const input = await screen.findByLabelText("Anthropic API key");
    expect(input.getAttribute("type")).toBe("password");
    expect(screen.getByText(/console\.anthropic\.com/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "sk-ant-api03-made-up" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(saveAiKey).toHaveBeenCalledWith("sk-ant-api03-made-up");
    expect(await screen.findByText(/Key set · \$4\.1 of \$20 this month/)).toBeTruthy();
    expect(screen.queryByLabelText("Anthropic API key")).toBeNull();
    expect(screen.queryByDisplayValue("sk-ant-api03-made-up")).toBeNull();
  });

  it("signs in with Claude: opens the link, then takes the code back", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Claude" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(LINK, "_blank", "noopener,noreferrer"));
    fireEvent.change(screen.getByLabelText("Code from claude.ai"), {
      target: { value: "abc123#state" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish sign-in" }));
    expect(finishSignIn).toHaveBeenCalledWith("abc123#state");
    expect(await screen.findByText(/Signed in/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
    open.mockRestore();
  });
});
