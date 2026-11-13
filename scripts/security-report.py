"""Turns scanner output into PR annotations and one security summary. Standard library only.

parse <tool> <report.json> <out.json>: print PR annotations, write a summary for the report job.
comment <dir> <sha>: build the PR comment from every summary in <dir>.
"""

import json
import pathlib
import sys

CHECKS = {
    "gitleaks": "Secrets",
    "trivy": "Packages and IaC",
    "checkov": "IaC policies",
    "semgrep": "Code",
}
# Most severe first; a scanner that rates nothing counts as UNKNOWN.
SEVERITY = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "UNKNOWN": "⚪"}
URGENT = ("CRITICAL", "HIGH")
SEMGREP_SEVERITY = {"ERROR": "HIGH", "WARNING": "MEDIUM", "INFO": "LOW"}
MARKER = "<!-- security-report -->"


def rel(path):
    for prefix in ("/repo/", "/src/", "/"):
        if path.startswith(prefix):
            return path[len(prefix) :]
    return path


def esc(text):
    return str(text).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def esc_prop(text):
    # A ',' or ':' would end an annotation's file= or title= value early.
    return esc(text).replace(":", "%3A").replace(",", "%2C")


def rating(value):
    value = str(value or "").upper()
    return value if value in SEVERITY else "UNKNOWN"


# Each scanner yields (file, line, rule, message, severity, fix); fixes show for critical and high.
def gitleaks(data):
    for f in data or []:
        fix = "rotate the secret now, then remove it from git history"
        msg = "Secret found (redacted)"
        yield f["File"], f.get("StartLine", 1), f["RuleID"], msg, "CRITICAL", fix


def trivy(data):
    for r in data.get("Results") or []:
        for v in r.get("Vulnerabilities") or []:
            fixed = v.get("FixedVersion")
            pkg = f"{v['PkgName']} {v['InstalledVersion']}"
            msg = f"{pkg}, fixed in {fixed}" if fixed else f"{pkg}, no fix yet"
            fix = f"upgrade {v['PkgName']} to {fixed}" if fixed else ""
            yield r["Target"], 1, v["VulnerabilityID"], msg, rating(v.get("Severity")), fix
        for m in r.get("Misconfigurations") or []:
            line = (m.get("CauseMetadata") or {}).get("StartLine") or 1
            fix = m.get("Resolution") or ""
            yield r["Target"], line, m["ID"], m["Title"], rating(m.get("Severity")), fix


def checkov(data):
    for block in data if isinstance(data, list) else [data]:
        for c in (block.get("results") or {}).get("failed_checks") or []:
            line = (c.get("file_line_range") or [1])[0]
            path = c["file_path"].lstrip("/")
            fix = f"see {c['guideline']}" if c.get("guideline") else ""
            yield path, line, c["check_id"], c["check_name"], rating(c.get("severity")), fix


def semgrep(data):
    for r in data.get("results") or []:
        rule = r["check_id"].split(".")[-1]
        sev = SEMGREP_SEVERITY.get(r["extra"].get("severity"), "UNKNOWN")
        refs = (r["extra"].get("metadata") or {}).get("references") or []
        fix = f"see {refs[0]}" if refs else ""
        if r["extra"].get("fix"):
            fix = f"replace with `{r['extra']['fix']}`"
        yield r["path"], r["start"]["line"], rule, r["extra"]["message"].split("\n")[0], sev, fix


SCANNERS = {"gitleaks": gitleaks, "trivy": trivy, "checkov": checkov, "semgrep": semgrep}


def parse(tool, report, out):
    try:
        text = pathlib.Path(report).read_text(encoding="utf-8").strip()
        data = json.loads(text) if text else ([] if tool == "gitleaks" else {})
    except (OSError, json.JSONDecodeError):
        data = None
    if data is None:
        summary = {"tool": tool, "error": True, "count": 0, "severity": {}, "top": []}
    else:
        items = [
            (rel(f), int(line), r, m, s, x if s in URGENT else "")
            for f, line, r, m, s, x in SCANNERS[tool](data)
        ]
        items.sort(key=lambda i: list(SEVERITY).index(i[4]))
        for f, line, rule, msg, sev, fix in items[:50]:
            title = esc_prop(f"{tool} {rule}")
            text = f"{sev}: {msg}" + (f". Fix: {fix}" if fix else "")
            print(f"::error file={esc_prop(f)},line={line},title={title}::{esc(text)}")
        counts = {s: sum(1 for i in items if i[4] == s) for s in SEVERITY}
        top = [
            f"{SEVERITY[s]} {rule}: {msg} ({f}:{line})" + (f"<br>**Fix:** {x}" if x else "")
            for f, line, rule, msg, s, x in items[:3]
        ]
        summary = {
            "tool": tool,
            "error": False,
            "count": len(items),
            "severity": {s: n for s, n in counts.items() if n},
            "top": top,
        }
    pathlib.Path(out).write_text(json.dumps(summary), encoding="utf-8")


def cell(text):
    return text.replace("|", "\\|").replace("\n", " ")


def badges(counts):
    return " · ".join(f"{SEVERITY[s]} {counts[s]}" for s in SEVERITY if counts.get(s))


def comment(folder, sha):
    rows, top, failed, total = [], [], 0, {}
    for tool, check in CHECKS.items():
        path = pathlib.Path(folder) / f"{tool}.json"
        s = (
            json.loads(path.read_text(encoding="utf-8"))
            if path.exists()
            else {"error": True, "count": 0, "severity": {}, "top": []}
        )
        if s["error"]:
            failed += 1
            result = "Didn't finish: see the job log"
        elif s["count"]:
            failed += 1
            result = badges(s["severity"])
            for sev, n in s["severity"].items():
                total[sev] = total.get(sev, 0) + n
            top += [f"- {cell(t)}" for t in s["top"]]
            if s["count"] > len(s["top"]):
                top.append(f"- …and {s['count'] - len(s['top'])} more from {check}")
        else:
            result = "✅"
        rows.append(f"| {check} ({tool.capitalize()}) | {result} |")
    status = "✅ all passed" if not failed else f"❌ {failed} failed"
    print(f"{MARKER}\n### Security checks: {status} ({sha[:7]})\n")
    print("| Check | Findings |\n|---|:-:|")
    print("\n".join(rows))
    # A check that didn't finish has no findings to count, so only a clean run earns the tick.
    print(f"| **Total** | **{badges(total) or ('–' if failed else '✅')}** |")
    if top:
        urgent = any(total.get(s) for s in URGENT)
        summary = "<details open><summary>Fix first" if urgent else "<details><summary>Top findings"
        print(f"\n{summary}</summary>\n")
        print("\n".join(top))
        print("\n</details>")
    if failed:
        names = {"UNKNOWN": "unrated"}
        legend = " · ".join(f"{e} {names.get(s, s.lower())}" for s, e in SEVERITY.items())
        print(f"\n{legend}. Each finding is also marked on its line under Files changed.")


if __name__ == "__main__":
    # The comment has emoji; a Windows console defaults to a code page without them.
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    if sys.argv[1] == "parse":
        parse(*sys.argv[2:5])
    else:
        comment(*sys.argv[2:4])
