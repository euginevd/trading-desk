import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarkdownFile } from "./types";
import "./markdown.css";

// A small Markdown renderer for the desk's own files (profile.md, trade.md): headings, lists,
// quotes, tables, rules and inline bold, italic, code and links. It builds React elements, never
// HTML strings, so nothing in a file can run as markup. A list row the desk wrote as
// "Label: value | Label: value" reads as labelled pairs; a backslash keeps a mark as text.

type Block =
  | { kind: "h"; level: number; text: string; id: string }
  | { kind: "ul"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "hr" }
  | { kind: "p"; text: string };

export function slug(text: string): string {
  return (
    "md-" +
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

// Splits on a mark the file didn't escape with a backslash.
function splitOn(text: string, mark: string): string[] {
  const parts: string[] = [];
  let here = "";
  for (let i = 0; i < text.length;) {
    if (text[i] === "\\" && i + 1 < text.length) {
      here += text.slice(i, i + 2);
      i += 2;
    } else if (text.startsWith(mark, i)) {
      parts.push(here);
      here = "";
      i += mark.length;
    } else {
      here += text[i];
      i += 1;
    }
  }
  return [...parts, here];
}

const cells = (line: string) =>
  splitOn(line.trim().replace(/^\|/, "").replace(/\|$/, ""), "|").map((c) => c.trim());

export function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const at = (n: number) => lines[n] ?? "";
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = at(i).trim();
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (!trimmed) {
      flush();
    } else if (heading) {
      flush();
      const text = (heading[2] ?? "").trim();
      blocks.push({ kind: "h", level: (heading[1] ?? "#").length, text, id: slug(text) });
    } else if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ kind: "hr" });
    } else if (/^[-*]\s+/.test(trimmed)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(at(i).trim())) {
        items.push(
          at(i)
            .trim()
            .replace(/^[-*]\s+/, ""),
        );
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "ul", items });
    } else if (trimmed.startsWith(">")) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && at(i).trim().startsWith(">")) {
        quoted.push(at(i).trim().replace(/^>\s?/, ""));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "quote", lines: quoted });
    } else if (trimmed.startsWith("|") && /^\|?\s*:?-{3,}/.test(at(i + 1).trim())) {
      flush();
      const head = cells(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && at(i).trim().startsWith("|")) {
        rows.push(cells(at(i)));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "table", head, rows });
    } else {
      para.push(trimmed);
    }
  }
  flush();
  return blocks;
}

const INLINE =
  /(\\.)|\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\s][^*]*?)\*(?!\w)/g;

export function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    if (m[1]) out.push(m[1].slice(1));
    else if (m[2] !== undefined) out.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<code key={key++}>{m[3]}</code>);
    else if (m[4] !== undefined) {
      const href = m[5] ?? "";
      out.push(
        /^https?:\/\//.test(href) ? (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer">
            {m[4]}
          </a>
        ) : (
          m[4]
        ),
      );
    } else if (m[6] !== undefined) out.push(<em key={key++}>{m[6]}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Value({ text }: { text: string }) {
  return text === "Not set" ? <span className="md-unset">Not set</span> : <Inline text={text} />;
}

// "Label: value", or several of them split by bars: a labelled row.
function Item({ text }: { text: string }) {
  const pairs = splitOn(text, " | ").map((part) => {
    const at = part.indexOf(": ");
    return at > 0 && at < 40 ? { label: part.slice(0, at), value: part.slice(at + 2) } : null;
  });
  if (pairs.every(Boolean) && pairs.length > 1) {
    const [first, ...rest] = pairs as { label: string; value: string }[];
    if (!first) return null;
    return (
      <li className="md-row">
        <span className="md-row-main">
          <Value text={first.value} />
        </span>
        {rest.map((p, j) => (
          <span key={`${j}-${p.label}`} className="md-pair">
            <span className="md-label">{p.label}</span> <Value text={p.value} />
          </span>
        ))}
      </li>
    );
  }
  const one = pairs.length === 1 ? pairs[0] : null;
  if (one) {
    return (
      <li className="md-field">
        <span className="md-label">{one.label}</span>
        <span className="md-value">
          <Value text={one.value} />
        </span>
      </li>
    );
  }
  return (
    <li>
      <Inline text={text} />
    </li>
  );
}

export default function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const Tag = `h${b.level}` as "h1" | "h2" | "h3" | "h4";
            return (
              <Tag key={i} id={b.id}>
                <Inline text={b.text} />
              </Tag>
            );
          }
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((item, j) => (
                  <Item key={j} text={item} />
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={i}>
                {b.lines.map((line, j) => (
                  <p key={j}>
                    <Inline text={line} />
                  </p>
                ))}
              </blockquote>
            );
          case "table":
            return (
              <div key={i} className="md-table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j}>
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((c, k) => (
                          <td key={k}>
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={i} />;
          default:
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

// The full-page reader: contents down the side, the document in a reading column.
export function Reader({
  title,
  meta,
  markdown,
  error,
  fileName,
  onClose,
  onEdit,
  onRetry,
}: {
  title: string;
  meta: string;
  markdown: string | null;
  error: string;
  fileName: string;
  onClose: () => void;
  onEdit?: () => void;
  onRetry: () => void;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = box.current;
    if (d && !d.open) d.showModal?.();
  }, []);
  const contents = useMemo(
    () =>
      markdown
        ? parse(markdown).filter(
            (b): b is Extract<Block, { kind: "h" }> => b.kind === "h" && b.level === 2,
          )
        : [],
    [markdown],
  );
  const download = () => {
    if (!markdown) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <dialog ref={box} className="md-reader" aria-label={title} onClose={onClose}>
      <header className="md-bar">
        <button type="button" onClick={() => box.current?.close?.()}>
          <span aria-hidden="true">←</span> Close
        </button>
        <span className="md-bar-title">
          <strong>{title}</strong>
          {meta && <span className="muted"> · {meta}</span>}
        </span>
        <span className="md-bar-actions">
          <button type="button" onClick={download} disabled={!markdown}>
            Export .md
          </button>
          {onEdit && (
            <button type="button" className="primary" onClick={onEdit}>
              Edit
            </button>
          )}
        </span>
      </header>
      <div className="md-layout">
        {contents.length > 0 && (
          <nav className="md-contents" aria-label="Contents">
            <span className="md-contents-h">Contents</span>
            {contents.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() =>
                  body.current
                    ?.querySelector(`#${h.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <Inline text={h.text} />
              </button>
            ))}
          </nav>
        )}
        <div className="md-body" ref={body}>
          {error ? (
            <p className="error-text" role="alert">
              {error}{" "}
              <button type="button" className="md-link" onClick={onRetry}>
                Try again
              </button>
            </p>
          ) : markdown === null ? (
            <p className="muted" aria-busy="true">
              Loading…
            </p>
          ) : (
            <Markdown text={markdown} />
          )}
        </div>
      </div>
    </dialog>
  );
}

// The file's state, shared by both tabs: a red line when its latest edit didn't parse, and how
// to change it.
export function FileNote({
  name,
  file,
  version,
}: {
  name: string;
  file: MarkdownFile | null;
  version: number;
}) {
  return (
    <>
      {file?.error && (
        <p className="error-text pf-file-error" role="alert">
          {name} has a problem: {file.error.replace(/\.$/, "")}. The desk is still using v{version}.
        </p>
      )}
      <p className="muted pf-file-note">
        To change it, ask Claude Code to edit <code>local/{name}</code>.
      </p>
    </>
  );
}

// Loads a Markdown file and opens it in the reader on request.
export function useMarkdownFile(load: () => Promise<MarkdownFile>) {
  const [file, setFile] = useState<MarkdownFile | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const fetchFile = useCallback(() => {
    load().then(
      (next) => {
        setError("");
        setFile(next);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : "The file couldn't be read."),
    );
  }, [load]);
  useEffect(() => fetchFile(), [fetchFile]);
  return { file, error, open, setOpen, retry: fetchFile };
}
