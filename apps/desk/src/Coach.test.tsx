import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function part<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("The fixture is missing a part.");
  return value;
}

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
    expect(getRecaps).toHaveBeenCalledTimes(2);
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

  it("lays out the week with the plan's buys on their days", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    const rail = await screen.findByRole("region", { name: "This week" });
    const days = within(rail).getAllByRole("button");
    expect(days).toHaveLength(7);
    expect(days[0]?.getAttribute("aria-label")).toBe("Monday 16 Nov, today");
    expect(days[4]?.getAttribute("aria-label")).toBe("Friday 20 Nov: A$500 buy");
    // Fear & Greed is 22, under 40: the extra buy applies this week.
    await waitFor(() =>
      expect(days[6]?.getAttribute("aria-label")).toBe("Sunday 22 Nov: +A$250: F&G 22"),
    );
    expect(
      within(rail).getByText("Today: nothing planned. Next: your A$500 buy on Friday."),
    ).toBeTruthy();
    fireEvent.mouseEnter(part(days[6]));
    expect(
      await within(rail).findByText(
        "Sunday 22 Nov: +A$250 when Fear & Greed is under 40. Fear & Greed is 22 (extreme fear), so it applies this week.",
      ),
    ).toBeTruthy();
    fireEvent.focus(part(days[4]));
    expect(
      await within(rail).findByText(
        "Friday 20 Nov: your A$500 weekly buy. Limit orders from your split, likely to fill within three days.",
      ),
    ).toBeTruthy();
  });

  it("shows the DCA book's weekly buy in USDC when there's a plan", async () => {
    const base = week();
    coach = {
      ...down,
      pending: false,
      week: {
        ...base,
        days: base.days.map((d) => (d.kind === "extra" ? { ...d, kind: "" } : d)),
        extra: null,
        buy: base.buy && {
          ...base.buy,
          usdc: "600",
          boughtUsdc: "0",
          quote: "USDC",
          coins: ["BTC", "ETH", "SOL"],
        },
      },
    };
    render(<CoachPage />);
    const rail = await screen.findByRole("region", { name: "This week" });
    const days = within(rail).getAllByRole("button");
    expect(days[4]?.getAttribute("aria-label")).toBe("Friday 20 Nov: 600 USDC DCA");
    expect(
      within(rail).getByText("Today: nothing planned. Next: your 600 USDC DCA on Friday."),
    ).toBeTruthy();
    fireEvent.focus(part(days[4]));
    expect(
      await within(rail).findByText(
        "Friday 20 Nov: your weekly DCA. Deposit A$500; 600 USDC of it buys BTC, ETH and SOL by limit orders, the rest goes to the trading pot.",
      ),
    ).toBeTruthy();
  });

  it("says when the buy is due, done or missed", async () => {
    coach = { ...down, pending: false, week: week("due", "2026-11-20") };
    render(<CoachPage />);
    const rail = await screen.findByRole("region", { name: "This week" });
    expect(within(rail).getByText("A$500 buy today")).toBeTruthy();
    expect(within(rail).getByText(/^Today: your A\$500 weekly buy\. Limit orders/)).toBeTruthy();
    cleanup();
    coach = { ...down, pending: false, week: week("done", "2026-11-21") };
    render(<CoachPage />);
    expect(await screen.findByText("✓ A$500 bought")).toBeTruthy();
    cleanup();
    coach = { ...down, pending: false, week: week("missed", "2026-11-21") };
    render(<CoachPage />);
    expect(await screen.findByText("A$500 not bought")).toBeTruthy();
  });

  it("shows no rail before the plan is profile.md v2", async () => {
    coach = { ...down, pending: false, week: null };
    render(<CoachPage />);
    expect(await screen.findByText("Evening, Sam.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "This week" })).toBeNull();
  });

  it("shows the month's deposits against the cap and the owner's lesson", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    expect(await screen.findByText("A$4.2K")).toBeTruthy();
    expect(screen.getByText(/of your A\$6K cap\. A\$1.8K left\./)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("70");
    expect(screen.queryByText(/this financial year/)).toBeNull(); // the Portfolio's Money in
    expect(screen.getByText("Raised the monthly cap, and kept it lower after")).toBeTruthy();
    expect(screen.queryByText(/ over\./)).toBeNull();
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
    expect((await screen.findByText("A$500 over.")).className).toBe("dash-over");
  });

  it("lists what to watch, rules marked", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    const watch = await screen.findByRole("region", { name: "Watch today" });
    expect(watch.textContent).toContain("TAOis 41% of your portfolio, over your 25% cap.Rule");
    expect(watch.textContent).toContain("SOLmoved most of what you hold: −18.2% today.");
    expect(within(watch).getByText(/is in its add zone/)).toBeTruthy();
  });

  it("asks Morgan first, and opens Riley's thread", async () => {
    coach = { ...down, pending: false };
    render(<CoachPage />);
    const morgan = await screen.findByRole("button", { name: "Morgan, Desk Coordinator" });
    expect(morgan.getAttribute("aria-pressed")).toBe("true");
    expect(getAgent).toHaveBeenCalledWith("desk");
    expect(screen.getByText("Advice only. Nothing is placed from the Dashboard.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Riley, Risk Officer" }));
    await waitFor(() => expect(getAgent).toHaveBeenCalledWith("risk"));
    expect(screen.getByText("Sizes and limits.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message to Riley"), {
      target: { value: "Should I add TAO?" },
    });
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

  it("shows last week in a line, opens it, and lists the earlier weeks", async () => {
    coach = { ...down, pending: false };
    recaps = [
      recap("2026-11-15", "Held steady through the dip.", true),
      recap("2026-11-08", "A week of buys at your levels."),
    ];
    render(<CoachPage />);
    expect(await screen.findByText("Held steady through the dip.")).toBeTruthy();
    expect(screen.getByText(/Out of date · your Profile changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read the recap" }));
    expect(screen.getByText("Up 2% on the week.")).toBeTruthy();
    fireEvent.click(screen.getByText("Earlier weeks (1)"));
    expect(screen.getByText("A week of buys at your levels.")).toBeTruthy();
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
