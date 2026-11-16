import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentInfo, AgentThread, Coach, Recap } from "./types";

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
    lesson: { year: "2026", text: "Raised the monthly cap, and kept it lower after" },
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

const recap = (week: string, headline: string, outOfDate = false): Recap => ({
  week,
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
  getAgents: () => Promise.resolve({ agents: team }),
  getAgent: (id: string) => getAgent(id),
  sendAgent: (id: string, text: string) => sendAgent(id, text),
  getRecaps: () => getRecaps(),
  writeRecap: () => writeRecap(),
}));

const { default: CoachPage } = await import("./Coach");

afterEach(() => {
  cleanup();
  coach = down;
  recaps = [];
  vi.clearAllMocks();
});

describe("the coach Dashboard", () => {
  it("greets, gives the mood and figures, then the model's words when they come", async () => {
    render(<CoachPage />);
    expect(await screen.findByRole("heading", { name: "Evening, Sam." })).toBeTruthy();
    expect(screen.getByText(/Your portfolio is down 12\.4% today/)).toBeTruthy();
    expect(screen.getByText("(−A$8,340)")).toBeTruthy();
    expect(screen.getByText(/Sharp down/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("A hard day, and it passes.")).toBeTruthy());
    expect(writeCoach).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("refreshes the coach from its button, busy while it reads", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    const button = await screen.findByRole("button", { name: "Refresh" });
    expect(getCoach).toHaveBeenCalledTimes(1);
    coach = { ...down, pending: false, greeting: "Evening again, Sam." };
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Refreshing" })).toHaveProperty("disabled", true);
    expect(await screen.findByRole("heading", { name: "Evening again, Sam." })).toBeTruthy();
    expect(getCoach).toHaveBeenCalledTimes(2);
    expect(getRecaps).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", false);
  });

  it("marks the coach's message out of date once the Profile changed", async () => {
    coach = { ...down, pending: false, message: { ...down.message, outOfDate: true } };
    render(<CoachPage />);
    expect(await screen.findByText(/Out of date · your Profile changed/)).toBeTruthy();
  });

  it("shows the year, the month against the cap, what's left and the owner's lesson", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    expect(await screen.findByText("A$21,500.00")).toBeTruthy();
    expect(screen.getByText(/of A\$6,000\.00 · A\$1,800\.00 left/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("70");
    expect(screen.getByText(/Your lesson · 2026 —/)).toBeTruthy();
    expect(screen.getByText("Raised the monthly cap, and kept it lower after")).toBeTruthy();
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

  it("shows the team: Morgan leads and is open first, the four report to Morgan", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    const morgan = await screen.findByRole("button", { name: "Morgan, Desk Coordinator" });
    expect(morgan.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Reports to Morgan")).toBeTruthy();
    for (const name of [
      "Riley, Risk Officer",
      "Quinn, Market Researcher",
      "Kai, Technical Analyst",
      "Ellis, Tax Specialist (AU)",
    ]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    }
    expect(getAgent).toHaveBeenCalledWith("desk");
    expect(screen.getByPlaceholderText("Ask Morgan…")).toBeTruthy();
    expect(screen.getByText("Advice only. Nothing is placed from the Dashboard.")).toBeTruthy();
  });

  it("opens Riley's thread and keeps the placeholder reply", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Riley, Risk Officer" }));
    await waitFor(() => expect(getAgent).toHaveBeenCalledWith("risk"));
    expect(screen.getByRole("heading", { name: /^Riley\s*·\s*Risk Officer$/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message to Riley"), {
      target: { value: "Should I add TAO?" },
    });
    expect(screen.getByPlaceholderText("Ask Riley…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(sendAgent).toHaveBeenCalledWith("risk", "Should I add TAO?");
    expect(await screen.findByText("Riley will answer here soon.")).toBeTruthy();
  });

  it("says when the first recap comes, and writes one now", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    expect(await screen.findByText("Your first recap comes on Sunday at 6 pm.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write now" }));
    expect(await screen.findByText("A calm week inside your rules.")).toBeTruthy();
    expect(writeRecap).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Week to 15 Nov 2026/)).toBeTruthy();
  });

  it("shows the newest recap, marks it out of date, and lists the past ones", async () => {
    coach = { ...down, pending: false };
    recaps = [
      recap("2026-11-15", "Held steady through the dip.", true),
      recap("2026-11-08", "A week of buys at your levels."),
    ];
    render(<CoachPage />);
    expect(await screen.findByText("Held steady through the dip.")).toBeTruthy();
    expect(screen.getByText(/Out of date · your Profile changed/)).toBeTruthy();
    fireEvent.click(screen.getByText("Past recaps (1)"));
    expect(screen.getByText("A week of buys at your levels.")).toBeTruthy();
    expect(screen.getByText("· 8 Nov 2026")).toBeTruthy();
  });

  it("offers a retry when the recaps can't be read", async () => {
    coach = { ...down, pending: false };
    getRecaps.mockImplementationOnce(() => Promise.reject(new Error("The api couldn't answer.")));
    render(<CoachPage />);
    expect(await screen.findByText("The api couldn't answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Your first recap comes on Sunday at 6 pm.")).toBeTruthy();
  });
});
