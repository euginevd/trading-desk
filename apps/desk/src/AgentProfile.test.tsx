// The trading agent tab on the Profile page (TODO 6). Made-up figures only (known-mistakes 7).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDoc, AgentPage } from "./types";

function doc(changes: Partial<AgentDoc> = {}): AgentDoc {
  return {
    name: "Jordan",
    title: "Trader",
    style: "balanced",
    focus: "both",
    brief: "Build toward my targets with my monthly deposits.",
    always: ["Say what would change your mind"],
    never: [],
    confidenceFloor: 50,
    autonomy: "propose",
    steps: {
      macro: { on: true, model: "haiku" },
      technical: { on: true, model: "haiku" },
      planfit: { on: true, model: "haiku" },
      debate: { on: false, model: "sonnet" },
      risk: { on: true, model: "haiku" },
      decision: { on: true, model: "opus" },
    },
    ...changes,
  };
}

function page(version = 0, changes: Partial<AgentPage> = {}): AgentPage {
  return {
    version,
    time: version ? Date.UTC(2026, 10, 14, 2) : null,
    agent: doc(),
    history: [],
    told: "You are Jordan, the owner's trader. Style: Balanced.",
    estimate: "0.08",
    models: [
      { id: "haiku", name: "Haiku 5.5" },
      { id: "sonnet", name: "Sonnet 5.5" },
      { id: "opus", name: "Opus 5.5" },
    ],
    steps: [
      { key: "macro", title: "Macro and events", who: "Quinn", fixed: false },
      { key: "technical", title: "Technicals", who: "Kai", fixed: false },
      { key: "planfit", title: "Plan fit and tax", who: "Ellis", fixed: false },
      { key: "debate", title: "Bull against bear", who: "two takes", fixed: false },
      { key: "risk", title: "Risk", who: "Riley", fixed: true },
      { key: "decision", title: "Decision", who: "Jordan", fixed: true },
    ],
    ...changes,
  };
}

const api = {
  getTradingAgent: vi.fn(),
  saveTradingAgent: vi.fn(),
  getTradingAgentVersion: vi.fn(),
  restoreTradingAgent: vi.fn(),
};
vi.mock("./api", () => ({
  getTradingAgent: () => api.getTradingAgent(),
  saveTradingAgent: (a: AgentDoc) => api.saveTradingAgent(a),
  getTradingAgentVersion: (n: number) => api.getTradingAgentVersion(n),
  restoreTradingAgent: (n: number) => api.restoreTradingAgent(n),
  exportTradingAgent: vi.fn(),
  importTradingAgent: vi.fn(),
}));

const { default: AgentProfile } = await import("./AgentProfile");

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(cleanup);

describe("trading agent tab", () => {
  it("shows the defaults as not saved yet, with the steps, the cost and what the agent is told", async () => {
    api.getTradingAgent.mockResolvedValue(page());
    render(<AgentProfile />);
    expect(await screen.findByText(/Not saved yet: these are the defaults/)).toBeTruthy();
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Jordan");
    expect(screen.getByText("about $0.08")).toBeTruthy();
    expect(screen.getByText(/You are Jordan, the owner's trader/)).toBeTruthy();
    // Risk and Decision always run; Bull against bear is off.
    expect(screen.getByRole("switch", { name: "Risk on" })).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("switch", { name: "Bull against bear on" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: /Auto within limits/ }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Save as v1" })).toHaveProperty("disabled", true);
  });

  it("saves the edits as a new version", async () => {
    api.getTradingAgent.mockResolvedValue(page());
    render(<AgentProfile />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Sam Lee" } });
    expect(screen.getAllByText("SL").length).toBeGreaterThan(0); // the avatar's initials
    fireEvent.click(screen.getByRole("button", { name: /^Careful/ }));
    fireEvent.change(screen.getByLabelText("Add a line to Never"), {
      target: { value: "Chase a green day" },
    });
    const [, addNever] = screen.getAllByRole("button", { name: "Add" }); // Always, then Never
    if (!addNever) throw new Error("No Add button for Never");
    fireEvent.click(addNever);
    fireEvent.click(screen.getByRole("switch", { name: "Macro and events on" }));
    fireEvent.change(screen.getByLabelText("Technicals model"), { target: { value: "sonnet" } });
    expect(screen.getByText("5 changes")).toBeTruthy();

    const saved = page(1, {
      agent: doc({ name: "Sam Lee" }),
      history: [{ n: 1, time: Date.UTC(2026, 10, 15), author: "owner", summary: "First version" }],
    });
    api.saveTradingAgent.mockResolvedValue(saved);
    fireEvent.click(screen.getByRole("button", { name: "Save as v1" }));
    await screen.findByText("Saved as v1.");
    const sent = api.saveTradingAgent.mock.calls[0]?.[0] as AgentDoc;
    expect(sent.name).toBe("Sam Lee");
    expect(sent.style).toBe("careful");
    expect(sent.never).toEqual(["Chase a green day"]);
    expect(sent.steps.macro.on).toBe(false);
    expect(sent.steps.technical.model).toBe("sonnet");
    expect(screen.getByRole("button", { name: "Save as v2" })).toBeTruthy();
  });

  it("discards edits back to the saved version", async () => {
    api.getTradingAgent.mockResolvedValue(page());
    render(<AgentProfile />);
    fireEvent.change(await screen.findByLabelText("Brief"), { target: { value: "Do nothing." } });
    expect(screen.getByText("1 change")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText("No changes")).toBeTruthy();
    expect(screen.getByLabelText("Brief")).toHaveProperty(
      "value",
      "Build toward my targets with my monthly deposits.",
    );
  });

  it("compares an older version and restores it", async () => {
    const history = [
      { n: 2, time: Date.UTC(2026, 10, 14), author: "owner", summary: "Style Careful → Balanced" },
      { n: 1, time: Date.UTC(2026, 10, 8), author: "owner", summary: "First version" },
    ];
    api.getTradingAgent.mockResolvedValue(page(2, { history }));
    api.getTradingAgentVersion.mockResolvedValue({
      n: 1,
      agent: doc({ style: "careful" }),
      changes: [{ label: "Style", from: "Careful", to: "Balanced" }],
    });
    api.restoreTradingAgent.mockResolvedValue(
      page(3, {
        agent: doc({ style: "careful" }),
        history: [
          { n: 3, time: Date.UTC(2026, 10, 15), author: "owner", summary: "Restored v1" },
          ...history,
        ],
      }),
    );
    render(<AgentProfile />);
    fireEvent.click(await screen.findByRole("button", { name: "Compare" }));
    const compared = await screen.findByLabelText("v1 against the current version");
    expect(within(compared).getByText("Careful")).toBeTruthy();
    expect(within(compared).getByText("Balanced")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore v1" }));
    await screen.findByText("v1 restored as v3.");
    expect(api.restoreTradingAgent).toHaveBeenCalledWith(1);
    expect(screen.getByRole("button", { name: /^Careful/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("says when the agent can't be read, with a retry", async () => {
    api.getTradingAgent.mockRejectedValueOnce(new Error("The desk's api isn't running."));
    render(<AgentProfile />);
    expect(await screen.findByText("The desk's api isn't running.")).toBeTruthy();
    api.getTradingAgent.mockResolvedValue(page());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
  });
});
