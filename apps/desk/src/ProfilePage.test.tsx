// The Profile page (decision 58). Made-up figures only (known-mistakes 7).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project } from "./ProfileTools";
import type {
  ProfileDoc,
  ProfileGoal,
  ProfileHolding,
  ProfilePage,
  ProfileSuggestion,
} from "./types";

function doc(): ProfileDoc {
  return {
    identity: { name: "Sam", date_of_birth: "1988-03-04" },
    income: {
      gross_monthly_aud: "18000",
      after_tax_monthly_aud: null,
      living_monthly_aud: null,
      available_monthly_aud: "5600",
      notes: null,
    },
    goals: [
      {
        label: "First milestone",
        amount: "500000",
        currency: "USD",
        date: "2030-12-31",
        then_rule: "never drop below it",
      },
    ],
    foundations: {
      emergency_fund_aud: "30000",
      emergency_months: "6",
      parked_funds_aud: null,
      min_cash_aud: "60000",
      insurance: [],
      health_cover_status: "parked",
      health_cover_monthly_aud: "350",
      debt: "none",
      wills: null,
    },
    strategy: { text: "Cash floor first.", focus: null, targets: [] },
    rules: {
      monthly_deposit_cap_aud: "4000",
      deposit_cadence: "weekly",
      max_pct_per_coin: "40",
      per_trade_aud: null,
      max_loss_pct: null,
      rebalance_band: null,
      take_profit_rule: null,
      entry_strategy: null,
      behaviour_rules: ["No buying after a 20% day"],
    },
    holdings: [
      {
        name: "Binance",
        source: "binance",
        invested_aud: "118000",
        value_aud: null,
        cash: false,
        counts: true,
      },
    ],
    lessons: [{ year: "2025", text: "Doubled deposits, then stopped." }],
    quotes: [],
    additional_info: "",
    locks: { goals: true, min_cash: false, deposit_cap: true },
  };
}

function page(version = 14, changes: Partial<ProfilePage> = {}): ProfilePage {
  return {
    version,
    time: Date.UTC(2026, 10, 15, 2),
    profile: doc(),
    updated: {
      identity: Date.UTC(2026, 10, 2),
      income: null,
      goals: null,
      foundations: null,
      strategy: null,
      rules: Date.UTC(2026, 10, 9),
      holdings: null,
      lessons: null,
      quotes: null,
      additional_info: null,
    },
    live: {
      known: true,
      strip: {
        totalAud: "212400",
        totalUsd: "141600",
        nextGoal: { ...(doc().goals[0] as ProfileGoal), pct: "28.3", have: "141600" },
        cash: { now: "45000", floor: "60000", pct: "75", status: "attention" },
        month: { spent: "2600", cap: "4000", pct: "65", status: "ok" },
      },
      holdings: [
        {
          ...(doc().holdings[0] as ProfileHolding),
          now_aud: "110500",
          pnl_aud: "-7500",
          pnl_pct: "-6.4",
        },
      ],
      checks: {
        monthly_deposit_cap_aud: { status: "ok", text: "A$2,600 bought this month of A$4,000" },
        max_pct_per_coin: { status: "broken", text: "ETH 52% vs max 40%" },
      },
      foundations: {
        emergency_fund_aud: "done",
        min_cash_aud: "below",
        health_cover_status: "parked",
      },
    },
    suggestions: [],
    planner: null,
    recap: null,
    ...changes,
  };
}

const suggestion: ProfileSuggestion = {
  id: "abc123abc123",
  time: 1,
  author: "Command bar",
  baseVersion: 14,
  sections: { rules: { ...doc().rules, max_pct_per_coin: "35" } },
  changes: [
    { section: "rules", key: "max_pct_per_coin", label: "Max % per coin", from: "40%", to: "35%" },
  ],
  summary: "Max per coin 40% → 35%",
  reason: "",
  conflicts: ["ETH is 52% already, over a 35% max: no more buying it."],
  blocked: null,
};

const api = {
  getProfilePage: vi.fn(),
  saveProfileSection: vi.fn(),
  askProfile: vi.fn(),
  acceptSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  getProfileVersions: vi.fn(),
  getProfileVersion: vi.fn(),
  restoreProfile: vi.fn(),
  getScorecard: vi.fn(),
};
vi.mock("./api", () => ({
  getProfilePage: () => api.getProfilePage(),
  saveProfileSection: (s: string, v: unknown, r: string) => api.saveProfileSection(s, v, r),
  askProfile: (t: string) => api.askProfile(t),
  acceptSuggestion: (id: string, r: string) => api.acceptSuggestion(id, r),
  rejectSuggestion: (id: string) => api.rejectSuggestion(id),
  getProfileVersions: () => api.getProfileVersions(),
  getProfileVersion: (n: number) => api.getProfileVersion(n),
  restoreProfile: (n: number) => api.restoreProfile(n),
  getScorecard: () => api.getScorecard(),
  importProfile: vi.fn(),
  exportProfile: vi.fn(),
  reviewAllocation: vi.fn(),
}));

const { default: Profile } = await import("./ProfilePage");

function card(section: string) {
  const found = document.getElementById(`pf-card-${section}`);
  if (!found) throw new Error(`No ${section} card`);
  return within(found);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getProfilePage.mockResolvedValue(page());
  api.getScorecard.mockResolvedValue({
    windows: {
      "30": [
        {
          rule: "max_pct_per_coin",
          label: "Max % per coin",
          kept: 3,
          broken: 1,
          brokenResultPct: "-6",
        },
      ],
      "90": [],
    },
  });
});
afterEach(cleanup);

describe("Profile", () => {
  it("shows every section, the version chip, the strip and unset rules as Not set", async () => {
    render(<Profile />);
    expect(await screen.findByRole("button", { name: "Version history, now v14" })).toBeTruthy();
    expect(screen.getByText("v14 · 15 Nov 2026")).toBeTruthy();
    for (const title of [
      "Identity",
      "Income",
      "Goals",
      "Foundations",
      "Strategy",
      "Rules",
      "Holdings",
      "Lessons",
      "Quotes",
      "Additional info",
    ])
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText("A$212,400")).toBeTruthy();
    expect(screen.getByText("A$45,000 / A$60,000")).toBeTruthy();
    const rules = card("rules");
    expect(rules.getByText("ETH 52% vs max 40%")).toBeTruthy();
    expect(rules.getAllByText("Not set").length).toBeGreaterThan(2);
    expect(rules.getAllByText("Not checked").length).toBeGreaterThan(0);
    expect(rules.getByText("Deposit cap locked")).toBeTruthy();
    expect(await rules.findByText(/Max % per coin: broken 1 of 4/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up with wizard" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("saves a card's edit as a new version", async () => {
    api.saveProfileSection.mockResolvedValue(page(15));
    render(<Profile />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
    fireEvent.change(screen.getByLabelText("Per-trade size"), { target: { value: "2K" } });
    fireEvent.change(screen.getByLabelText("Why (optional, kept with the version)"), {
      target: { value: "Smaller bites" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await waitFor(() => expect(api.saveProfileSection).toHaveBeenCalled());
    const [section, value, reason] = api.saveProfileSection.mock.calls[0] ?? [];
    expect([section, (value as ProfileDoc["rules"]).per_trade_aud, reason]).toEqual([
      "rules",
      "2K",
      "Smaller bites",
    ]);
    expect((value as ProfileDoc["rules"]).max_loss_pct).toBeNull(); // still Not set
    expect(await screen.findByText("Saved as v15.")).toBeTruthy();
  });

  it("shows a command bar change as a diff with conflicts, and accepts it", async () => {
    api.askProfile.mockResolvedValue({ kind: "change", suggestion });
    api.getProfilePage
      .mockResolvedValueOnce(page())
      .mockResolvedValue(page(14, { suggestions: [suggestion] }));
    api.acceptSuggestion.mockResolvedValue(page(15));
    render(<Profile />);
    fireEvent.change(await screen.findByLabelText("Ask or change your profile"), {
      target: { value: "max per coin 35%" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const rulesCard = card("rules");
    expect(await rulesCard.findByText("1 suggestion")).toBeTruthy();
    expect(rulesCard.getByText("40%", { selector: "del" })).toBeTruthy();
    expect(rulesCard.getByText("35%", { selector: "ins" })).toBeTruthy();
    expect(rulesCard.getByText(/Conflict: ETH is 52% already/)).toBeTruthy();
    fireEvent.click(rulesCard.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.acceptSuggestion).toHaveBeenCalledWith("abc123abc123", ""));
  });

  it("answers a question under the bar and changes nothing", async () => {
    api.askProfile.mockResolvedValue({
      kind: "answer",
      answer: "Behind: 28% of the way.",
      question: "am I on track?",
      profileVersion: 14,
    });
    render(<Profile />);
    fireEvent.click(await screen.findByRole("button", { name: "Review my rules" }));
    expect(await screen.findByText("Behind: 28% of the way.")).toBeTruthy();
    expect(api.askProfile).toHaveBeenCalledWith(expect.stringContaining("Which of my rules"));
    expect(api.saveProfileSection).not.toHaveBeenCalled();
  });

  it("blocks accepting a change to a locked field", async () => {
    const locked = { ...suggestion, blocked: "Deposit cap locked: unlock on the card first." };
    api.getProfilePage.mockResolvedValue(page(14, { suggestions: [locked] }));
    render(<Profile />);
    const card = within(await screen.findByLabelText("Suggested by Command bar"));
    expect(card.getByText(/Deposit cap locked/)).toBeTruthy();
    expect(card.getByRole("button", { name: "Accept" })).toHaveProperty("disabled", true);
  });

  it("compares two versions and restores one as a new version", async () => {
    api.getProfileVersions.mockResolvedValue({
      versions: [
        { n: 14, time: 2, author: "You", summary: "Max % per coin 35% → 40%", reason: "" },
        { n: 13, time: 1, author: "Command bar", summary: "Added 2025 lesson", reason: "" },
      ],
    });
    const older = doc();
    older.rules.max_pct_per_coin = "35";
    api.getProfileVersion.mockImplementation((n: number) =>
      Promise.resolve({
        n,
        time: n,
        author: "You",
        summary: "",
        reason: "",
        profile: n === 13 ? older : doc(),
      }),
    );
    api.restoreProfile.mockResolvedValue(page(15));
    render(<Profile />);
    fireEvent.click(await screen.findByRole("button", { name: "Version history, now v14" }));
    fireEvent.click(await screen.findByLabelText("Compare v14"));
    fireEvent.click(screen.getByLabelText("Compare v13"));
    expect(await screen.findByText("Rules · Max % per coin")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore v13" }));
    expect(await screen.findByText("v13 restored as v15.")).toBeTruthy();
  });

  it("says when live figures couldn't be read, with dashes for the totals", async () => {
    const off = page();
    off.live = { ...off.live, known: false };
    api.getProfilePage.mockResolvedValue(off);
    render(<Profile />);
    expect(await screen.findByText(/Live figures couldn't be read/)).toBeTruthy();
    expect(screen.getByText("Live figures unavailable")).toBeTruthy();
    expect(screen.queryByText("A$212,400")).toBeNull();
  });

  it("shows an error with a retry", async () => {
    api.getProfilePage
      .mockRejectedValueOnce(new Error("The api couldn't answer."))
      .mockResolvedValue(page());
    render(<Profile />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Rules" })).toBeTruthy();
  });
});

describe("What-if", () => {
  it("compounds monthly with each month's amount added", () => {
    expect(project(1000, 100, 0, 3)).toEqual([1000, 1100, 1200, 1300]);
    expect(project(1000, 0, 12, 12).at(-1)).toBeGreaterThan(1120);
  });
});
