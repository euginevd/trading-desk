import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSettings } from "./types";

const saved: AiSettings = {
  mode: "api_key",
  fallback: false,
  apiKeySet: false,
  tokenSet: false,
  model: "claude-opus-5-5",
  models: [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
  ],
  budget: { spent: "4.1", cap: "20" },
};
const LINK = "https://claude.com/cai/oauth/authorize?code=true";

const setAiSettings = vi.fn((mode: AiSettings["mode"], fallback: boolean, model: string) =>
  Promise.resolve({ ...saved, mode, fallback, model }),
);
const saveAiKey = vi.fn((key: string) => key && Promise.resolve({ ...saved, apiKeySet: true }));
const startSignIn = vi.fn(() => Promise.resolve({ url: LINK }));
const finishSignIn = vi.fn((code: string) => code && Promise.resolve({ ...saved, tokenSet: true }));
vi.mock("./api", () => ({
  getTelegram: () =>
    Promise.resolve({ tokenSet: false, chatFound: false, time: "07:30", lastSent: null }),
  saveTelegramToken: () =>
    Promise.resolve({ tokenSet: true, chatFound: false, time: "07:30", lastSent: null }),
  setTelegramTime: (time: string) =>
    Promise.resolve({ tokenSet: true, chatFound: true, time, lastSent: null }),
  testTelegram: () =>
    Promise.resolve({ tokenSet: true, chatFound: true, time: "07:30", lastSent: "2026-11-15" }),
  getProfile: () => Promise.resolve({ name: "" }),
  setProfile: (name: string) => Promise.resolve({ name }),
  getAiSettings: () => Promise.resolve(saved),
  setAiSettings: (mode: AiSettings["mode"], fallback: boolean, model: string) =>
    setAiSettings(mode, fallback, model),
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
    expect(setAiSettings).toHaveBeenCalledWith("subscription", false, "claude-opus-5-5");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Use the API key if the subscription fails" }),
    );
    expect(setAiSettings).toHaveBeenLastCalledWith("subscription", true, "claude-opus-5-5");
  });

  it("switches the model", async () => {
    render(<SettingsPage />);
    expect(
      (await screen.findByRole("button", { name: "Opus 5.5" })).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Haiku 5.5" }));
    expect(setAiSettings).toHaveBeenLastCalledWith("api_key", false, "claude-haiku-5-5");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Haiku 5.5" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
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

  it("connects Telegram with a bot token, then sends a test", async () => {
    render(<SettingsPage />);
    expect(await screen.findByText("Not connected")).toBeTruthy();
    const input = screen.getByLabelText("Telegram bot token");
    expect(input.getAttribute("type")).toBe("password");
    fireEvent.change(input, { target: { value: "123456789:made-up" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Bot saved: send it a message in Telegram")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send a test" }));
    expect(await screen.findByText("Test summary sent")).toBeTruthy();
  });
});
