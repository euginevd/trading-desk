import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentThread, Coach, TradingPlan } from "./types";

// Made-up figures only (known-mistakes 7).
const down: Coach = {
  greeting: "Evening, Sam.",
  mood: "sharp_down",
  moodLabel: "Sharp down",
  changePct: "-12.4",
  changeAud: "-8340",
  streak: null,
  takeProfit: null,
  withinRules: false,
  deposits: {
    known: true,
    fy: "2026-27",
    fyAud: "21500",
    monthAud: "4200",
    capAud: "6000",
    leftAud: "1800",
    overAud: null,
    usedPct: "70",
    lesson: { date: "2026-09-03", happened: "Raised the monthly cap", learned: "Keep it lower" },
  },
  keyPoints: [
    { kind: "concentration", coin: "TAO", pct: "41", cap: "25", rule: true },
    { kind: "mover", coin: "SOL", pct: "-18.2", rule: false },
    { kind: "addZone", coin: "ETH", low: "3050", high: "3180", rule: false },
  ],
  day: "2026-11-15",
  message: {
    lines: ["Days like this are hard to watch, and they pass.", "One of your rules needs a look."],
    coach: "A$1,800 left under your cap.",
    quote: { text: "Opportunities always come back.", author: "Me" },
    link: null,
    source: "plain",
  },
  pending: true,
};
const written: Coach = {
  ...down,
  message: { ...down.message, lines: ["A hard day, and it passes."], source: "model" },
  pending: false,
};
const thread: AgentThread = { id: "risk", name: "Risk Officer", messages: [] };

const writeCoach = vi.fn(() => Promise.resolve(written));
const sendAgent = vi.fn((id: string, text: string) =>
  Promise.resolve({
    ...thread,
    id,
    messages: [
      { role: "owner" as const, text, time: 1 },
      { role: "agent" as const, text: "Risk Officer will answer here soon.", time: 1 },
    ],
  }),
);
const saveTradingPlan = vi.fn((section: string, body: unknown) =>
  Promise.resolve(section && body ? plan : plan),
);
let coach: Coach = down;

const plan: TradingPlan = {
  goals: {
    text: "Long-term BTC.",
    targets: [{ coin: "BTC", pct: "40" }],
    updated: 1_794_000_000_000,
  },
  strategy: { text: "", updated: null },
  rules: {
    monthlyCapAud: "6000",
    maxCoinPct: "25",
    tradeBudgetAud: "500",
    maxLossPct: "20",
    takeProfit: "Trim at +15% in a week.",
    behaviour: ["No FOMO"],
    notes: "",
    driftBand: "5",
    updated: 1_794_000_000_000,
    history: [
      { time: 1_794_000_000_000, rule: "Monthly deposit cap (A$)", from: "4000", to: "6000" },
    ],
  },
  lessons: { items: [], updated: null },
  quotes: { items: [{ text: "Opportunities always come back.", author: "Me" }], updated: null },
};

vi.mock("./api", () => ({
  getCoach: () => Promise.resolve(coach),
  writeCoach: () => writeCoach(),
  getAgents: () =>
    Promise.resolve({
      agents: [
        { id: "desk", name: "Ask the desk" },
        { id: "risk", name: "Risk Officer" },
      ],
    }),
  getAgent: (id: string) => Promise.resolve({ ...thread, id }),
  sendAgent: (id: string, text: string) => sendAgent(id, text),
  getTradingPlan: () => Promise.resolve(plan),
  saveTradingPlan: (section: string, body: unknown) => saveTradingPlan(section, body),
}));

const { default: CoachPage } = await import("./Coach");
const { default: PlanPage } = await import("./PlanPage");

afterEach(() => {
  cleanup();
  coach = down;
});

describe("the coach Dashboard", () => {
  it("greets, gives the mood and figures, then the model's words when they come", async () => {
    render(<CoachPage />);
    expect(await screen.findByRole("heading", { name: "Evening, Sam." })).toBeTruthy();
    expect(screen.getByText(/Your portfolio is down 12\.4% today/)).toBeTruthy();
    expect(screen.getByText("(−A$8,340)")).toBeTruthy();
    expect(screen.getByText(/Sharp down/)).toBeTruthy();
    expect(screen.getByText(/Opportunities always come back/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("A hard day, and it passes.")).toBeTruthy());
    expect(writeCoach).toHaveBeenCalledTimes(1);
  });

  it("shows the year, the month against the cap, what's left and the owner's note", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    expect(await screen.findByText("A$21,500.00")).toBeTruthy();
    expect(screen.getByText(/of A\$6,000\.00 · A\$1,800\.00 left/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("70");
    expect(screen.getByText("Raised the monthly cap")).toBeTruthy();
    expect(screen.queryByText(/Over your monthly cap/)).toBeNull();
  });

  it("warns in amber over the cap", async () => {
    coach = {
      ...down,
      pending: false,
      deposits: {
        ...down.deposits,
        monthAud: "6500",
        leftAud: "0",
        overAud: "500",
        usedPct: "108.3",
      },
    };
    render(<CoachPage />);
    expect(await screen.findByText("Over your monthly cap by A$500.00")).toBeTruthy();
  });

  it("lists today's key points, rules marked", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    expect(
      await screen.findByText(/TAO is 41% of your portfolio, over your 25% cap\./),
    ).toBeTruthy();
    expect(screen.getByText("Rule")).toBeTruthy();
    expect(screen.getByText(/SOL moved most of what you hold: −18\.2% today\./)).toBeTruthy();
    expect(screen.getByText(/ETH is in its add zone/)).toBeTruthy();
  });

  it("keeps a thread per agent, with a placeholder reply", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Risk Officer" }));
    fireEvent.change(await screen.findByLabelText("Message to Risk Officer"), {
      target: { value: "Should I add TAO?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(sendAgent).toHaveBeenCalledWith("risk", "Should I add TAO?");
    expect(await screen.findByText("Risk Officer will answer here soon.")).toBeTruthy();
  });
});

describe("the Plan page", () => {
  it("saves each section and shows the rules' history", async () => {
    render(<PlanPage />);
    const strategy = await screen.findByLabelText("Strategy");
    fireEvent.change(strategy, { target: { value: "Buy in steps." } });
    fireEvent.click(screen.getByRole("button", { name: "Save strategy" }));
    expect(saveTradingPlan).toHaveBeenCalledWith("strategy", { text: "Buy in steps." });
    fireEvent.click(screen.getByRole("button", { name: "+ Add a lesson" }));
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "Chased" } });
    fireEvent.click(screen.getByRole("button", { name: "Save lessons" }));
    const [, lessons] = saveTradingPlan.mock.calls.at(-1) ?? [];
    expect((lessons as { items: { happened: string }[] }).items[0]?.happened).toBe("Chased");
    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));
    expect(screen.getByText("4000 → 6000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    expect(saveTradingPlan).toHaveBeenLastCalledWith(
      "rules",
      expect.objectContaining({ monthlyCapAud: "6000", behaviour: ["No FOMO"] }),
    );
    expect(screen.getByLabelText("Quote")).toBeTruthy();
  });
});
