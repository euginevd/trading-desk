import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentInfo, AgentThread, Coach, CoachWeek, Recap, Sentiment } from "./types";

// Made-up figures only (known-mistakes 7).
// A week in the Profile's plan: A$500 on Friday, A$250 more on Sunday when F&G is under 40.
const week = (
  state: "upcoming" | "due" | "done" | "missed" = "upcoming",
  today = "2026-11-16",
): CoachWeek => ({
  today,
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name, i) => ({
    date: `2026-11-${16 + i}`,
    name,
    kind: name === "Fri" ? "buy" : name === "Sun" ? "extra" : "",
  })),
  buy: { date: "2026-11-20", aud: "500", boughtAud: state === "done" ? "500" : "0", state },
  extra: { date: "2026-11-22", aud: "250", fearGreedBelow: 40, state: "upcoming" },
  boughtAud: state === "done" ? "500" : "0",
  maxWeekAud: "750",
  maxMonthAud: "3000",
});
const fear: Sentiment = { value: 22, label: "Extreme Fear", yesterday: 25, updated: 1 };

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
    lesson: { year: "2026", text: "Raised the monthly cap, and kept it lower after" },
  },
  keyPoints: [
    { kind: "concentration", coin: "TAO", pct: "41", cap: "25", rule: true },
    { kind: "mover", coin: "SOL", pct: "-18.2", rule: false },
    { kind: "addZone", coin: "ETH", low: "3050", high: "3180", rule: false },
  ],
  day: "2026-11-15",
  week: week(),
  message: {
    lines: ["Days like this are hard to watch, and they pass.", "One of your rules needs a look."],
    coach: "A$1,800 left under your cap.",
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

const team: AgentInfo[] = [
  {
    id: "desk",
    name: "Morgan",
    title: "Desk Coordinator",
    remit: "Your first stop.",
    reportsTo: null,
  },
  {
    id: "risk",
    name: "Riley",
    title: "Risk Officer",
    remit: "Sizes and limits.",
    reportsTo: "desk",
  },
  { id: "research", name: "Quinn", title: "Market Researcher", remit: "News.", reportsTo: "desk" },
  { id: "technical", name: "Kai", title: "Technical Analyst", remit: "Charts.", reportsTo: "desk" },
  { id: "tax", name: "Ellis", title: "Tax Specialist (AU)", remit: "CGT.", reportsTo: "desk" },
];
const threadOf = (id: string): AgentThread => {
  const a = team.find((t) => t.id === id) ?? team[0];
  return { id, name: a?.name ?? "", title: a?.title ?? "", messages: [] };
};

const recap = (day: string, headline: string, outOfDate = false): Recap => ({
  week: day,
  time: 1,
  source: "plain",
  headline,
  lines: ["Up 2% on the week."],
  profileVersion: 3,
  outOfDate,
});

const getCoach = vi.fn(() => Promise.resolve(coach));
const writeCoach = vi.fn(() => Promise.resolve(written));
const getAgent = vi.fn((id: string) => Promise.resolve(threadOf(id)));
const sendAgent = vi.fn((id: string, text: string) =>
  Promise.resolve({
    ...threadOf(id),
    messages: [
      { role: "owner" as const, text, time: 1 },
      { role: "agent" as const, text: "Riley will answer here soon.", time: 1 },
    ],
  }),
);
let recaps: Recap[] = [];
const getRecaps = vi.fn(() => Promise.resolve({ recaps }));
const writeRecap = vi.fn(() =>
  Promise.resolve({ recap: recap("2026-11-15", "A calm week inside your rules.") }),
);
let coach: Coach = down;

vi.mock("./api", () => ({
  getCoach: () => getCoach(),
  writeCoach: () => writeCoach(),
  getSentiment: () => Promise.resolve(fear),
  getAgents: () => Promise.resolve({ agents: team }),
  getAgent: (id: string) => getAgent(id),
  sendAgent: (id: string, text: string) => sendAgent(id, text),
  getRecaps: () => getRecaps(),
  writeRecap: () => writeRecap(),
  getDcaBook: () => new Promise(() => undefined), // the DCA widget has its own tests
  closeOutDca: () => Promise.resolve({ closed: [] }),
}));

const { default: CoachPage } = await import("./Coach");

afterEach(() => {
  cleanup();
  coach = down;
  recaps = [];
  vi.clearAllMocks();
});

describe("the Dashboard", () => {
  it("says how the day is going in a sentence, then the model's words when they come", async () => {
    render(<CoachPage />);
    expect(await screen.findByText("Evening, Sam.")).toBeTruthy();
    const day = screen.getByRole("heading", { level: 2, name: /^(Up|Down) / });
    expect(day.textContent).toBe("Down 12.4% today, −A$8.3K.");
    await waitFor(() => expect(screen.getByText("A hard day, and it passes.")).toBeTruthy());
    expect(writeCoach).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("refreshes from its button, busy while it reads", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    const button = await screen.findByRole("button", { name: "Refresh" });
    expect(getCoach).toHaveBeenCalledTimes(1);
    coach = { ...down, pending: false, greeting: "Evening again, Sam." };
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Refreshing" })).toHaveProperty("disabled", true);
    expect(await screen.findByText("Evening again, Sam.")).toBeTruthy();
    expect(getCoach).toHaveBeenCalledTimes(2);
  });

  it("reads again when the tab comes back, and rolls a figure that moved", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    expect(await screen.findByText("−A$8.3K")).toBeTruthy();
    coach = { ...down, pending: false, changeAud: "-7900", changePct: "-11.8" };
    document.dispatchEvent(new Event("visibilitychange"));
    const moved = await screen.findByText("−A$7.9K");
    expect(moved.closest(".pf-live")?.className).toBe("pf-live rise");
  });

  it("marks the coach's message out of date once the Profile changed", async () => {
    coach = { ...down, pending: false, message: { ...down.message, outOfDate: true } };
    render(<CoachPage />);
    expect(await screen.findByText(/Out of date · your Profile changed/)).toBeTruthy();
  });
});
