// The Profile page, read only (decisions 58 and 61). Made-up figures only (known-mistakes 7).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentPage,
  MarkdownFile,
  ProfileDoc,
  ProfileGoal,
  ProfileHolding,
  ProfilePage,
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

const PROFILE_MD = `# Profile

## Identity

- Name: Sam
- Date of birth: Not set

## Rules

- Max % per coin: **40%**
- Behaviour: No buying after a 20% day | Since: 2025
`;

const TRADE_MD = `# Trading agent

## Identity

- Name: Jordan
- Style: Balanced
`;

function file(markdown: string, error: string | null = null): MarkdownFile {
  return { markdown, version: 14, time: Date.UTC(2026, 10, 15, 2), error };
}

const api = {
  getProfilePage: vi.fn(),
  getProfileFile: vi.fn(),
  getProfileVersions: vi.fn(),
  getTradingAgent: vi.fn(),
  getAgentFile: vi.fn(),
};
vi.mock("./api", () => ({
  getProfilePage: () => api.getProfilePage(),
  getProfileFile: () => api.getProfileFile(),
  getProfileVersions: () => api.getProfileVersions(),
  getTradingAgent: () => api.getTradingAgent(),
  getAgentFile: () => api.getAgentFile(),
}));

const { default: Profile } = await import("./ProfilePage");

const agentPage: AgentPage = {
  version: 3,
  time: Date.UTC(2026, 10, 14, 2),
  agent: {
    name: "Jordan",
    title: "Trader",
    style: "balanced",
    focus: "both",
    brief: "",
    always: [],
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
  },
  history: [],
  told: "",
  estimate: "0.08",
  models: [],
  steps: [],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getProfilePage.mockResolvedValue(page());
  api.getProfileFile.mockResolvedValue(file(PROFILE_MD));
  api.getProfileVersions.mockResolvedValue({
    versions: [
      { n: 14, time: Date.UTC(2026, 10, 15), author: "owner", summary: "Rules", reason: "" },
      { n: 13, time: Date.UTC(2026, 10, 9), author: "owner", summary: "Goals", reason: "" },
    ],
  });
  api.getTradingAgent.mockResolvedValue(agentPage);
  api.getAgentFile.mockResolvedValue(file(TRADE_MD));
});
afterEach(cleanup);

describe("Profile", () => {
  it("is read only: the version, Show Profile, how to change it and the strip", async () => {
    render(<Profile />);
    expect(await screen.findByRole("button", { name: "Version history, now v14" })).toBeTruthy();
    expect(screen.getByText("v14 · 15 Nov 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show Profile" })).toBeTruthy();
    expect(screen.getByText(/To change it, ask Claude Code to edit/).textContent).toContain(
      "local/profile.md",
    );
    const strip = screen.getByRole("region", { name: "Where you stand" });
    expect(within(strip).getByText("A$212,400")).toBeTruthy();
    expect(within(strip).getByText("Below the floor")).toBeTruthy();
    // Nothing on the page edits the Profile.
    expect(screen.queryByRole("button", { name: /Import|Export|Save|Restore/ })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens profile.md in the reader, with its headings, fields and Not set", async () => {
    render(<Profile />);
    fireEvent.click(await screen.findByRole("button", { name: "Show Profile" }));
    const reader = await screen.findByRole("dialog", { name: "Profile" });
    expect(within(reader).getByText(/v14 · 15 Nov 2026 · read-only/)).toBeTruthy();
    expect(within(reader).getByRole("heading", { level: 2, name: "Rules" })).toBeTruthy();
    const contents = within(reader).getByRole("navigation", { name: "Contents" });
    expect(within(contents).getByRole("button", { name: "Identity" })).toBeTruthy();
    const field = within(reader).getByText("Max % per coin").closest("li");
    expect(field?.className).toBe("md-field");
    expect(field?.querySelector("strong")?.textContent).toBe("40%");
    expect(within(reader).getByText("Not set").className).toBe("md-unset");
    expect(within(reader).getByRole("button", { name: "Export .md" })).toBeTruthy();
    fireEvent.click(within(reader).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Profile" })).toBeNull());
  });

  it("says when profile.md has a problem and which version is in force", async () => {
    api.getProfileFile.mockResolvedValue(
      file(PROFILE_MD, "Start the file with “# Profile”, as an export does."),
    );
    render(<Profile />);
    expect(
      await screen.findByText(
        "profile.md has a problem: Start the file with “# Profile”, as an export does. The desk is still using v14.",
      ),
    ).toBeTruthy();
  });

  it("lists the versions read only", async () => {
    render(<Profile />);
    fireEvent.click(await screen.findByRole("button", { name: "Version history, now v14" }));
    const history = await screen.findByRole("complementary", { name: "Version history" });
    expect(await within(history).findByText("v14 · current")).toBeTruthy();
    expect(within(history).getByText("v13")).toBeTruthy();
    expect(within(history).queryByRole("button", { name: /Restore/ })).toBeNull();
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
    expect(await screen.findByText("The api couldn't answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Show Profile" })).toBeTruthy();
  });
});

describe("Trading agent tab", () => {
  it("shows the agent read only and opens trade.md", async () => {
    render(<Profile />);
    fireEvent.click(screen.getByRole("tab", { name: "Trading agent" }));
    const card = await screen.findByRole("region", { name: "Jordan" });
    expect(within(card).getByText("Trader · Balanced · DCA and swing")).toBeTruthy();
    expect(within(card).getByText("Propose")).toBeTruthy();
    expect(within(card).getByText("about $0.08")).toBeTruthy();
    expect(screen.getByText(/To change it, ask Claude Code to edit/).textContent).toContain(
      "local/trade.md",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Show Jordan's profile" }));
    const reader = await screen.findByRole("dialog", { name: "Jordan's profile" });
    expect(api.getAgentFile).toHaveBeenCalled();
    expect(within(reader).getByRole("heading", { level: 1, name: "Trading agent" })).toBeTruthy();
    expect(within(reader).getByText("Style").closest("li")?.className).toBe("md-field");
  });

  it("says when trade.md has a problem", async () => {
    api.getAgentFile.mockResolvedValue(file(TRADE_MD, "Unknown style “bold”."));
    render(<Profile />);
    fireEvent.click(screen.getByRole("tab", { name: "Trading agent" }));
    expect(
      await screen.findByText(
        "trade.md has a problem: Unknown style “bold”. The desk is still using v3.",
      ),
    ).toBeTruthy();
  });
});
