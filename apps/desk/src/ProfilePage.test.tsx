// The Profile page (decisions 58, 61 and 62). Made-up figures only (known-mistakes 7).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MyAgentsPage,
  MarkdownFile,
  ProfileBoard,
  ProfileDoc,
  ProfilePage,
  ProfileSuggestion,
} from "./types";

function board(): ProfileBoard {
  return {
    summary: {
      name: "Sam",
      age: 36,
      subline: "Crypto only for now · rules and automation decide",
      risk: "Aggressive",
      goalPct: "3.8",
      dca: {
        weeklyAud: "500",
        day: "Friday",
        extraAud: "250",
        fearGreedBelow: 40,
        maxMonthAud: "3000",
      },
      split: ["BTC 60%", "ETH, SOL 20% each"],
      splitLabel: "2026 split",
      cash: { totalAud: "20000", floorAud: "40000", below: true },
      chips: ["No leverage", "Sell only on thesis break", "Memes max 5%"],
      openItems: ["Exit trigger per coin: not set", "Health cover: not chosen"],
      lesson: {
        title: "2021 Peak",
        story: "no profit taken",
        lesson: "take profit at milestones",
      },
    },
    road: {
      known: true,
      goalUsd: "1000000",
      goalDate: "2030-12-31",
      ticks: [
        { usd: "150000", year: 2027, state: "next" },
        { usd: "500000", year: 2029, state: "" },
        { usd: "1000000", year: 2030, state: "" },
      ],
      then: { usd: "5000000", year: 2050 },
      totalUsd: "38000",
      totalAud: "57000",
      parts: { taoAud: "21000", binanceAud: "24000", emergencyAud: "12000" },
      pct: "3.8",
      onTrack: true,
      pathUsd: "32847",
      leg: {
        fromUsd: "0",
        toUsd: "150000",
        year: 2027,
        pct: "25.3",
        toGoUsd: "112000",
        monthsLeft: 13,
      },
      thenPct: "0.8",
      path: [
        { date: "2026-11-01", usd: "26000" },
        { date: "2027-12-31", usd: "150000" },
        { date: "2029-12-31", usd: "500000" },
        { date: "2030-12-31", usd: "1000000" },
      ],
      today: "2026-11-16",
    },
    stack: {
      known: true,
      target: "1",
      weeklyAud: "300",
      day: "Friday",
      bought: false,
      ticks: ["0.1", "0.25", "0.5", "0.75", "1"],
      held: "0.2",
      pct: "20",
      valueAud: "18000",
      priceAud: "90000",
      next: "0.25",
      leg: { from: "0.1", to: "0.25", pct: "66.7", toGo: "0.05", weeksLeft: 15 },
      projected: "2031-06-20",
    },
    cash: {
      totalAud: "20000",
      floorAud: "40000",
      pct: "50",
      parkedAud: "8000",
      emergencyAud: "12000",
      parkedPct: "20",
      emergencyPct: "30",
      monthlyAud: "1000",
      shortAud: "20000",
      full: false,
      ticks: [
        { aud: "20000", state: "passed" },
        { aud: "36000", state: "next" },
        { aud: "40000", state: "" },
      ],
      projected: "2028-07",
      emergency: { targetAud: "20000", pct: "60", toGoAud: "8000", months: 8 },
    },
    fx: { audPerUsd: "1.5", date: "2026-11-16" },
  };
}

// A part of the fixture the test knows is there.
function part<T>(value: T | null): T {
  if (value === null) throw new Error("The fixture is missing a part.");
  return value;
}

function page(version = 4, changes: Partial<ProfilePage> = {}): ProfilePage {
  return {
    version,
    time: Date.UTC(2026, 10, 15, 2),
    profile: {} as ProfileDoc, // the page reads the board, not the typed Profile
    updated: {} as ProfilePage["updated"],
    live: {
      known: true,
      strip: {
        totalAud: "57000",
        totalUsd: "38000",
        nextGoal: null,
        cash: { now: "20000", floor: "40000", pct: "50", status: "attention" },
        month: { spent: "0", cap: "3000", pct: "0", status: "ok" },
      },
      holdings: [],
      checks: {},
      foundations: {},
    },
    board: board(),
    suggestions: [],
    planner: null,
    recap: null,
    ...changes,
  };
}

const PROFILE_MD = `# Profile
- Name: Sam | age 36

## 2. Goals
1. **US$1M by 31 Dec 2030**

## 4. Foundations
1. Emergency fund (6 months): **~A$12K of A$20K**
`;

const AGENT_MD = `# weekly-buyer

Buys the weekly amount.

## Never

- Sell.
`;

function file(markdown: string, error: string | null = null): MarkdownFile {
  return { markdown, version: 4, time: Date.UTC(2026, 10, 15, 2), error };
}

const change: ProfileSuggestion = {
  id: "abc123abc123",
  time: Date.UTC(2026, 10, 16),
  author: "Command bar",
  baseVersion: 4,
  markdown: PROFILE_MD.replace("~A$12K", "~A$15K"),
  diff: [
    { kind: "same", text: "## 4. Foundations" },
    { kind: "del", text: "1. Emergency fund (6 months): **~A$12K of A$20K**" },
    { kind: "add", text: "1. Emergency fund (6 months): **~A$15K of A$20K**" },
  ],
  changes: [],
  summary: "Emergency fund (6 months) ~A$12K of A$20K → ~A$15K of A$20K",
  reason: "Bonus came in",
  conflicts: [],
  blocked: null,
};

const api = {
  getProfilePage: vi.fn(),
  getProfileFile: vi.fn(),
  getProfileVersions: vi.fn(),
  getProfileVersion: vi.fn(),
  restoreProfile: vi.fn(),
  askProfile: vi.fn(),
  acceptSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  getMyAgents: vi.fn(),
  getMyAgentFile: vi.fn(),
};
vi.mock("./api", () => ({
  getProfilePage: () => api.getProfilePage(),
  getProfileFile: () => api.getProfileFile(),
  getProfileVersions: () => api.getProfileVersions(),
  getProfileVersion: (n: number) => api.getProfileVersion(n),
  restoreProfile: (n: number) => api.restoreProfile(n),
  askProfile: (text: string) => api.askProfile(text),
  acceptSuggestion: (id: string) => api.acceptSuggestion(id),
  rejectSuggestion: (id: string) => api.rejectSuggestion(id),
  getMyAgents: () => api.getMyAgents(),
  getMyAgentFile: (slug: string) => api.getMyAgentFile(slug),
}));

const { default: Profile } = await import("./ProfilePage");

const agents: MyAgentsPage = {
  folder: "local/agents",
  agents: [
    {
      slug: "weekly-buyer",
      file: "agents/weekly-buyer.md",
      purpose: "buys the weekly amount",
      about: "Buys a little every week.",
      model: { id: "claude-opus-5-5", name: "Claude Opus 5.5", effort: "high" },
      autonomy: "propose",
      cost: "about $0.20 a week",
      icon: "dca",
      persona: { title: "The patient buyer", traits: "steady, never chases" },
      sends: "Telegram messages",
      coins: ["BTC", "ETH"],
      schedule: [
        { day: 4, minute: 1020, label: "deposit day" },
        { day: null, minute: null, label: "When the money lands" },
        { day: 0, minute: 1110, label: "close-out" },
      ],
      next: { at: new Date(2026, 10, 20, 17, 0).getTime(), label: "deposit day" },
      version: 2,
      time: Date.UTC(2026, 10, 16, 2),
      running: false,
    },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getProfilePage.mockResolvedValue(page());
  api.getProfileFile.mockResolvedValue(file(PROFILE_MD));
  api.getProfileVersions.mockResolvedValue({
    versions: [
      { n: 4, time: Date.UTC(2026, 10, 15), author: "You", summary: "Rules", reason: "" },
      {
        n: 3,
        time: Date.UTC(2026, 10, 9),
        author: "Command bar",
        summary: "Emergency fund (6 months) ~A$10K of A$20K → ~A$12K of A$20K",
        reason: "",
      },
    ],
  });
  api.getMyAgents.mockResolvedValue(agents);
  api.getMyAgentFile.mockResolvedValue({ markdown: AGENT_MD, error: null });
});
afterEach(cleanup);

describe("Profile", () => {
  it("shows the plan as a road over time and a ledger", async () => {
    render(<Profile />);
    expect(await screen.findByText("v4, 15 Nov 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View profile.md" })).toBeTruthy();
    expect(screen.getByText(/Your plan. Every agent follows it./)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Ask or change your plan" })).toBeTruthy();

    const road = screen.getByRole("region", { name: "Road to US$1M" });
    expect(within(road).getByRole("heading").textContent).toBe(
      "US$38K of US$1M. 3.8% of the way, on or above the line.",
    );
    expect(road.textContent).toContain("A$57K: Ledger A$21K, Binance A$24K, emergency fund A$12K.");
    expect(road.textContent).toContain("Next: US$150K by Dec 2027, US$112K to go in 13 months.");
    expect(road.textContent).toContain("Then US$5M by 2050, 0.8% there.");
    const chart = within(road).getByRole("figure");
    expect(within(chart).getByText("You")).toBeTruthy();
    expect(within(chart).getByText("US$500K")).toBeTruthy();

    const plan = screen.getByRole("region", { name: "The plan" });
    expect(plan.textContent).toContain("A$500 every Friday");
    expect(plan.textContent).toContain("+A$250 when Fear & Greed is under 40");
    expect(plan.textContent).toContain("A$3K a month at most");
    expect(within(plan).getByText("2026 split")).toBeTruthy();
    expect(within(plan).getByText("Memes max 5%")).toBeTruthy();

    const building = screen.getByRole("region", { name: "Building" });
    const stack = within(building).getByRole("group", { name: "Stack to 1 BTC" });
    expect(stack.textContent).toContain("0.2 BTC of 1, worth A$18K.");
    expect(within(stack).queryByText(/this week/)).toBeNull(); // the Dashboard's week rail
    expect(stack.textContent).toContain(
      "Next 0.25 BTC in 15 weekly buys of A$300. 1 BTC by Jun 2031 at today's price.",
    );
    const cash = within(building).getByRole("group", { name: "Cash floor" });
    expect(within(cash).getByText("A$20K short")).toBeTruthy();
    expect(cash.textContent).toContain("Full by Jul 2028 at A$1K a month.");
    expect(within(building).getByText("Open items")).toBeTruthy();
    expect(within(building).getByText("Take profit at milestones")).toBeTruthy();
    expect(screen.getByText(/^Sam, 36\./)).toBeTruthy();
    expect(screen.getByText("Aggressive risk")).toBeTruthy();
  });

  it("reads the plan month by month on the chart, by keyboard as by pointer", async () => {
    render(<Profile />);
    const chart = await screen.findByRole("slider", { name: /Plan over time/ });
    fireEvent.focus(chart);
    expect(chart.getAttribute("aria-valuetext")).toBe("Today: you US$38K, plan US$30K");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(chart.getAttribute("aria-valuetext")).toBe("Dec 2026, in 1 month: plan US$39K");
    expect(screen.getByText("Dec 2026, in 1 month: plan US$39K")).toBeTruthy(); // the readout
    fireEvent.keyDown(chart, { key: "End" });
    expect(chart.getAttribute("aria-valuetext")).toBe("Dec 2030, in 49 months: milestone US$1M");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByText(/milestone US\$1M/)).toBeNull();
  });

  it("reads the live figures again and rolls a figure that moved", async () => {
    render(<Profile />);
    const road = await screen.findByRole("region", { name: "Road to US$1M" });
    expect(within(road).getByText("US$38K").className).toBe("pf-live"); // first value: no roll
    const higher = page();
    higher.board = board();
    higher.board.road = { ...part(board().road), totalUsd: "41200", pct: "4.1" };
    api.getProfilePage.mockResolvedValue(higher);
    document.dispatchEvent(new Event("visibilitychange")); // as the minute's refresh does
    const moved = await within(road).findByText("US$41K");
    expect(moved.className).toBe("pf-live rise");
  });

  it("opens profile.md in the reader, with the rate the desk uses", async () => {
    render(<Profile />);
    fireEvent.click(await screen.findByRole("button", { name: "View profile.md" }));
    const reader = await screen.findByRole("dialog", { name: "Profile" });
    expect(within(reader).getByText(/v4, 15 Nov 2026\. US\$1 = A\$1\.5000/)).toBeTruthy();
    expect(within(reader).getByRole("heading", { level: 2, name: "2. Goals" })).toBeTruthy();
    expect(within(reader).getByRole("button", { name: "Export .md" })).toBeTruthy();
    expect(within(reader).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("answers a question from the command bar", async () => {
    api.askProfile.mockResolvedValue({
      kind: "answer",
      answer: "A$12K of A$20K.",
      question: "How's my emergency fund?",
      profileVersion: 4,
    });
    render(<Profile />);
    const box = await screen.findByRole("textbox", { name: "Ask or change your plan" });
    fireEvent.change(box, { target: { value: "How's my emergency fund?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("A$12K of A$20K.")).toBeTruthy();
    expect(api.askProfile).toHaveBeenCalledWith("How's my emergency fund?");
  });

  it("shows a change as a diff and saves it only on Accept", async () => {
    api.askProfile.mockResolvedValue({ kind: "change", suggestion: change });
    const after = page(5);
    after.board = board();
    after.board.cash = { ...part(board().cash), emergencyAud: "15000" };
    api.acceptSuggestion.mockResolvedValue(after);
    render(<Profile />);
    const box = await screen.findByRole("textbox", { name: "Ask or change your plan" });
    fireEvent.change(box, { target: { value: "Emergency fund is 15K now" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const diff = await screen.findByRole("list", { name: "Changes to profile.md" });
    expect(
      within(diff)
        .getByText(/~A\$12K of A\$20K/)
        .closest("li")?.className,
    ).toBe("del");
    expect(
      within(diff)
        .getByText(/~A\$15K of A\$20K/)
        .closest("li")?.className,
    ).toBe("add");
    expect(screen.getByText("Why: Bonus came in")).toBeTruthy();
    expect(api.acceptSuggestion).not.toHaveBeenCalled();
    api.getProfilePage.mockResolvedValue(after);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.acceptSuggestion).toHaveBeenCalledWith("abc123abc123"));
    expect(await screen.findByText("v5, 15 Nov 2026")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Changes to profile.md" })).toBeNull(),
    );
    expect(screen.getByText(/emergency fund A\$15K/)).toBeTruthy();
  });

  it("says why a change was refused", async () => {
    api.askProfile.mockRejectedValue(new Error("The change didn't match profile.md exactly."));
    render(<Profile />);
    const box = await screen.findByRole("textbox", { name: "Ask or change your plan" });
    fireEvent.change(box, { target: { value: "Change something" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("The change didn't match profile.md exactly.")).toBeTruthy();
  });

  it("lists the versions with a diff and restores an old one as a new version", async () => {
    api.getProfileVersion.mockResolvedValue({
      n: 3,
      time: Date.UTC(2026, 10, 9),
      author: "Command bar",
      summary: "",
      reason: "",
      markdown: PROFILE_MD,
      diff: [{ kind: "add", text: "1. Emergency fund (6 months): **~A$12K of A$20K**" }],
    });
    api.restoreProfile.mockResolvedValue(page(5));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Profile />);
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    const history = await screen.findByRole("complementary", { name: "Version history" });
    expect(await within(history).findByText("v4 · current")).toBeTruthy();
    fireEvent.click(part(within(history).getAllByRole("button", { name: "Diff" })[1] ?? null));
    const diff = await within(history).findByRole("list", { name: "What changed in v3" });
    expect(within(diff).getByText(/~A\$12K of A\$20K/)).toBeTruthy();
    fireEvent.click(within(history).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.restoreProfile).toHaveBeenCalledWith(3));
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("says when profile.md has a problem and which version is in force", async () => {
    api.getProfileFile.mockResolvedValue(file(PROFILE_MD, "Section 6 is missing from profile.md"));
    render(<Profile />);
    expect(
      await screen.findByText(
        "profile.md has a problem: Section 6 is missing from profile.md. The desk is still using v4.",
      ),
    ).toBeTruthy();
  });

  it("keeps the plan when live figures couldn't be read", async () => {
    const off = page();
    off.live = { ...off.live, known: false };
    off.board = board();
    off.board.road = { ...part(board().road), known: false };
    off.board.stack = { ...part(board().stack), known: false };
    api.getProfilePage.mockResolvedValue(off);
    render(<Profile />);
    expect(await screen.findByText(/Live figures couldn't be read, so/)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Live figures couldn't be read just now/ }),
    ).toBeTruthy();
    expect(screen.getByText("Live figures couldn't be read just now.")).toBeTruthy(); // the stack
    expect(screen.getByRole("group", { name: "Cash floor" })).toBeTruthy(); // from the file
  });

  it("shows an error with a retry", async () => {
    api.getProfilePage
      .mockRejectedValueOnce(new Error("The api couldn't answer."))
      .mockResolvedValue(page());
    render(<Profile />);
    expect(await screen.findByText("The api couldn't answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "View profile.md" })).toBeTruthy();
  });
});

describe("My agents tab", () => {
  it("lists each agent on a week, collapsed, and opens its file", async () => {
    render(<Profile />);
    fireEvent.click(screen.getByRole("tab", { name: "My agents" }));
    expect(await screen.findByText(/1 agent, none running on its own yet\./)).toBeTruthy();
    const row = screen.getByRole("button", { name: /^weekly-buyer/ });
    // At a glance: its next run from the file (by hand, no job yet), no last run, its state.
    expect(row.textContent).toContain("Deposit day, by hand for now");
    expect(row.textContent).toContain("Runs when you ask");
    expect(row.textContent).toContain("By hand");
    expect(row.getAttribute("aria-expanded")).toBe("false"); // collapsed until opened
    expect(screen.queryByRole("heading", { name: "Its week" })).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toContain("Opus 5.5");
    expect(screen.getByText("Claude Opus 5.5, high effort")).toBeTruthy();
    expect(screen.getByText("Proposes; you approve each order")).toBeTruthy();
    expect(screen.getByText("v2, 16 Nov 2026")).toBeTruthy();
    const week = screen.getByRole("heading", { name: "Its week" }).parentElement as HTMLElement;
    expect(
      within(week)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Fri 5pmDeposit day", "WhenThe money lands", "Mon 6:30pmClose-out"]);
    fireEvent.click(screen.getByRole("button", { name: "Read weekly-buyer.md" }));
    const reader = await screen.findByRole("dialog", { name: "weekly-buyer.md" });
    expect(api.getMyAgentFile).toHaveBeenCalledWith("weekly-buyer");
    expect(
      await within(reader).findByRole("heading", { level: 1, name: "weekly-buyer" }),
    ).toBeTruthy();
    fireEvent.click(row);
    expect(screen.queryByRole("heading", { name: "Its week" })).toBeNull();
  });

  it("says how to add the first agent", async () => {
    api.getMyAgents.mockResolvedValue({ folder: "local/agents", agents: [] });
    render(<Profile />);
    fireEvent.click(screen.getByRole("tab", { name: "My agents" }));
    expect(await screen.findByText("No agents yet.")).toBeTruthy();
    expect(screen.getByText(/ask Claude Code to write it in/).textContent).toContain(
      "local/agents/",
    );
  });
});
