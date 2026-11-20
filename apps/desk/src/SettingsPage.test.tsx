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
  effort: "medium",
  efforts: ["low", "medium", "high", "xhigh", "max"],
  budget: { spent: "4.1", cap: "20" },
};
const LINK = "https://claude.com/cai/oauth/authorize?code=true";

const setAiSettings = vi.fn(
  (mode: AiSettings["mode"], fallback: boolean, model: string, effort?: string) =>
    Promise.resolve({ ...saved, mode, fallback, model, effort: effort ?? saved.effort }),
);
const saveAiKey = vi.fn((key: string) => key && Promise.resolve({ ...saved, apiKeySet: true }));
const startSignIn = vi.fn(() => Promise.resolve({ url: LINK }));
const finishSignIn = vi.fn((code: string) => code && Promise.resolve({ ...saved, tokenSet: true }));
vi.mock("./api", () => ({
  getTelegram: () =>
    Promise.resolve({ tokenSet: false, chatFound: false, time: "07:30", lastSent: null }),
  saveTelegramToken: () =>
    Promise.resolve({
      tokenSet: true,
      chatFound: false,
      chatName: null,
      linkCode: "desk-482913",
      time: "07:30",
      lastSent: null,
    }),
  linkTelegram: () =>
    Promise.resolve({
      tokenSet: true,
      chatFound: true,
      chatName: "@sam",
      linkCode: null,
      time: "07:30",
      lastSent: null,
    }),
  setTelegramTime: (time: string) =>
    Promise.resolve({ tokenSet: true, chatFound: true, time, lastSent: null }),
  testTelegram: () =>
    Promise.resolve({ tokenSet: true, chatFound: true, time: "07:30", lastSent: "2026-11-15" }),
  getProfile: () => Promise.resolve({ name: "" }),
  setProfile: (name: string) => Promise.resolve({ name }),
  getAiSettings: () => Promise.resolve(saved),
  // Effort only when the page sends one, as the real call leaves it out.
  setAiSettings: (mode: AiSettings["mode"], fallback: boolean, model: string, effort?: string) =>
    effort === undefined
      ? setAiSettings(mode, fallback, model)
      : setAiSettings(mode, fallback, model, effort),
  saveAiKey: (key: string) => saveAiKey(key),
  startSignIn: () => startSignIn(),
  finishSignIn: (code: string) => finishSignIn(code),
}));

const { default: SettingsPage } = await import("./SettingsPage");

afterEach(cleanup);

describe("Settings", () => {
  it("switches to the subscription and offers the fall back", async () => {
    render(<SettingsPage />);
    const key = await screen.findByRole("radio", { name: "API key (pay per use)" });
    expect((key as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Not set up")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Claude subscription (personal use)" }));
    expect(setAiSettings).toHaveBeenCalledWith("subscription", false, "claude-opus-5-5");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Use the API key if the subscription fails" }),
    );
    expect(setAiSettings).toHaveBeenLastCalledWith("subscription", true, "claude-opus-5-5");
  });

  it("sets the effort for whichever model is chosen", async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("radio", { name: "Extra high" }));
    expect(setAiSettings).toHaveBeenLastCalledWith("api_key", false, "claude-opus-5-5", "xhigh");
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Extra high" }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(screen.getByText(/For hard calls/)).toBeTruthy();
  });

  it("switches the model", async () => {
    render(<SettingsPage />);
    const opus = (await screen.findByRole("radio", { name: "Opus 5.5" })) as HTMLInputElement;
    expect(opus.checked).toBe(true);
    expect(screen.getByText("The cheapest and fastest")).toBeTruthy();
    // The effort every model answers at, as the api reports it.
    // One effort for whichever model is chosen, Medium unless changed.
    const medium = screen.getByRole("radio", { name: "Medium" });
    expect(medium.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/The default: a balance/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Haiku 5.5" }));
    expect(setAiSettings).toHaveBeenLastCalledWith("api_key", false, "claude-haiku-5-5");
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: "Haiku 5.5" }) as HTMLInputElement).checked).toBe(
        true,
      ),
    );
    // The sentence follows the choice.
    expect(screen.getByRole("heading", { level: 2, name: /^The desk answers/ }).textContent).toBe(
      "The desk answers with Haiku 5.5 on your API key.",
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
    expect(await screen.findByText("Key set")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    // This month's spend is said once, in the sentence at the top.
    expect(screen.getAllByText(/\$4\.10 of \$20/)).toHaveLength(1);
    expect(screen.getByText(/^\$4\.10 of \$20 spent this month\./)).toBeTruthy();
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
    expect(await screen.findByText("Bot saved: link your chat")).toBeTruthy();
    expect(screen.getByText("desk-482913")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(await screen.findByText("Connected to @sam")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send a test" }));
    expect(await screen.findByText("Test summary sent")).toBeTruthy();
    // The day it went, as the desk writes dates, and the time in am and pm.
    expect(screen.getByText("15 Nov 2026")).toBeTruthy();
    expect(screen.getByText(/goes to Telegram at 7:30 am\./)).toBeTruthy();
  });
});

describe("amPm", () => {
  it("writes a 24-hour time in am and pm", async () => {
    const { amPm } = await import("./SettingsPage");
    expect(amPm("09:30")).toBe("9:30 am");
    expect(amPm("00:05")).toBe("12:05 am");
    expect(amPm("12:00")).toBe("12:00 pm");
    expect(amPm("19:45")).toBe("7:45 pm");
  });
});
