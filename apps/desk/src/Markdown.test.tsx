// The desk's Markdown renderer (decision 61): it builds React elements, never HTML.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Markdown, { Inline, parse } from "./Markdown";

afterEach(cleanup);

describe("parse", () => {
  it("reads headings, lists, quotes, rules and paragraphs", () => {
    const blocks = parse(
      "# Profile\r\n\n## Goals and rules\n\n- One\n- Two\n\n> Calm now,\n> calm later\n\n---\n\nA line\nwrapped",
    );
    expect(blocks).toEqual([
      { kind: "h", level: 1, text: "Profile", id: "md-profile" },
      { kind: "h", level: 2, text: "Goals and rules", id: "md-goals-and-rules" },
      { kind: "ul", items: ["One", "Two"] },
      { kind: "quote", lines: ["Calm now,", "calm later"] },
      { kind: "hr" },
      { kind: "p", text: "A line wrapped" },
    ]);
  });

  it("reads a table, keeping an escaped bar inside a cell", () => {
    const [table] = parse("| Coin | Note |\n| --- | --- |\n| BTC | a \\| b |\n| ETH | – |");
    expect(table).toEqual({
      kind: "table",
      head: ["Coin", "Note"],
      rows: [
        ["BTC", "a \\| b"],
        ["ETH", "–"],
      ],
    });
  });
});

describe("Inline", () => {
  it("renders bold, italic and code, and a backslash keeps a mark as text", () => {
    const { container } = render(
      <Inline text={"**Hold** the *line* with `code` and \\*stars\\*"} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Hold");
    expect(container.querySelector("em")?.textContent).toBe("line");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.textContent).toBe("Hold the line with code and *stars*");
  });

  it("links only to http and https", () => {
    const { container } = render(
      <Inline text="[safe](https://example.com) and [bad](javascript:alert(1)) and [local](/x)" />,
    );
    const links = container.querySelectorAll("a");
    expect(links.length).toBe(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("bad");
    expect(container.textContent).toContain("local");
  });

  it("shows an escaped bar as a bar", () => {
    const { container } = render(<Inline text={"a \\| b"} />);
    expect(container.textContent).toBe("a | b");
  });
});

describe("Markdown", () => {
  it("renders labelled fields, rows of pairs, Not set, the table and the quote", () => {
    render(
      <Markdown
        text={[
          "## Rules",
          "",
          "- Max % per coin: 40%",
          "- Per trade: Not set",
          "- Binance: A$1,000 | Cash: no | Counts: yes",
          "",
          "| Coin | Target |",
          "| --- | --- |",
          "| BTC | 25% |",
          "",
          "> Buy weakness, never chase.",
          "",
          "<script>alert(1)</script>",
        ].join("\n")}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Rules" })).toBeTruthy();
    expect(screen.getByText("Max % per coin").closest("li")?.className).toBe("md-field");
    expect(screen.getByText("Not set").className).toBe("md-unset");
    const row = screen.getByText("A$1,000").closest("li");
    expect(row?.className).toBe("md-row");
    expect(row?.textContent).toContain("Cash no");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "25%" })).toBeTruthy();
    expect(screen.getByText("Buy weakness, never chase.").closest("blockquote")).toBeTruthy();
    // Markup in a file is text, never elements.
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  });
});
