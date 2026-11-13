"""Turns Infracost output into PR annotations and one cost comment. Standard library only.

parse <unit> <infracost.json> <plan.json> <out.json>: annotate drivers, write a summary.
comment <dir> <sha> [limit]: build the PR comment from every summary in <dir>.
"""

import json
import pathlib
import re
import sys

MARKER = "<!-- cost-report -->"
CENT = 0.01
SMALL = 10
ADDRESS = re.compile(r"(aws_[a-z0-9_]+)\.([A-Za-z0-9_-]+)(?:\[[^\]]*\])?$")


def num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def nested(a, block, key):
    """A number inside a Terraform nested block, such as scaling_config.min_size."""
    return num(((a.get(block) or [{}])[0] or {}).get(key))


def always(a):
    return True


# One saving per resource type, shown only when the planned config doesn't already use it.
HINTS = {
    "aws_eks_node_group": [
        (lambda a: a.get("capacity_type") != "SPOT", "Spot capacity for dev"),
        (lambda a: nested(a, "scaling_config", "min_size") > 1, "minimum 1 node in dev"),
    ],
    "aws_eks_cluster": [(always, "destroy dev when idle")],
    "aws_rds_cluster": [
        (
            lambda a: nested(a, "serverlessv2_scaling_configuration", "min_capacity") > 0,
            "minimum capacity 0 so it pauses when idle",
        )
    ],
    "aws_rds_cluster_instance": [
        (lambda a: a.get("instance_class") != "db.serverless", "db.serverless scales down")
    ],
    "aws_db_instance": [(always, "a smaller class, or Aurora Serverless v2")],
    "aws_nat_gateway": [(always, "one shared NAT gateway, or VPC endpoints")],
    "aws_lb": [(always, "share one load balancer across the apps")],
    "aws_instance": [
        (
            lambda a: not str(a.get("instance_type", "")).split(".")[0].endswith("g"),
            "a Graviton type such as t4g is cheaper",
        )
    ],
    "aws_ebs_volume": [(lambda a: a.get("type") in (None, "gp2"), "gp3 is cheaper than gp2")],
    "aws_cloudwatch_log_group": [(lambda a: not a.get("retention_in_days"), "set a retention")],
}


def hint(rtype, after):
    return next((text for ok, text in HINTS.get(rtype, []) if ok(after or {})), "")


def esc(text):
    return str(text).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def esc_prop(text):
    # A ',' or ':' would end an annotation's file= or title= value early.
    return esc(text).replace(":", "%3A").replace(",", "%2C")


def money(value, currency, sign=False):
    symbol = {"USD": "$", "AUD": "A$"}.get(currency)
    text = f"{abs(value):,.2f}" if abs(value) < SMALL else f"{abs(value):,.0f}"
    text = f"{symbol}{text}" if symbol else f"{text} {currency}"
    return ("+" if value > 0 else "-" if value < 0 else "") + text if sign else text


def costs(breakdown):
    return {r["name"]: num(r.get("monthlyCost")) for r in (breakdown or {}).get("resources") or []}


def where(unit, unit_dir, address):
    """The repo path and line declaring a root-module resource, for the annotation."""
    m = ADDRESS.search(address)
    if not m or address.startswith("module."):
        return None, None
    decl = re.compile(rf'resource\s+"{m.group(1)}"\s+"{re.escape(m.group(2))}"')
    for tf in sorted(pathlib.Path(unit_dir).glob("*.tf")):
        for n, line in enumerate(tf.read_text(encoding="utf-8").splitlines(), 1):
            if decl.search(line):
                return f"infra/aws/{unit}/{tf.name}", n
    return None, None


def load(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def parse(unit, report, plan, out):
    try:
        data, changes = load(report), load(plan).get("resource_changes") or []
    except (OSError, json.JSONDecodeError):
        pathlib.Path(out).write_text(json.dumps({"unit": unit, "error": True}), encoding="utf-8")
        return
    after = {c["address"]: (c.get("change") or {}).get("after") for c in changes}
    currency = data.get("currency") or "USD"
    drivers = []
    for p in data.get("projects") or []:
        past, now = costs(p.get("pastBreakdown")), costs(p.get("breakdown"))
        for name in past.keys() | now.keys():
            delta = now.get(name, 0) - past.get(name, 0)
            if abs(delta) >= CENT:
                m = ADDRESS.search(name)
                tip = hint(m.group(1), after.get(name)) if m and delta > 0 else ""
                drivers.append({"address": name, "delta": round(delta, 2), "hint": tip})
    drivers.sort(key=lambda d: -abs(d["delta"]))
    for d in drivers[:5]:
        file, line = where(unit, pathlib.Path(out).parent, d["address"])
        if d["hint"] and file:
            title = esc_prop(f"cost {d['address']}")
            msg = f"{money(d['delta'], currency, sign=True)}/month. Consider: {d['hint']}"
            print(f"::warning file={esc_prop(file)},line={line},title={title}::{esc(msg)}")
    summary = {
        "unit": unit,
        "error": False,
        "currency": currency,
        "before": round(num(data.get("pastTotalMonthlyCost")), 2),
        "after": round(num(data.get("totalMonthlyCost")), 2),
        "drivers": drivers[:5],
    }
    pathlib.Path(out).write_text(json.dumps(summary), encoding="utf-8")


def comment(folder, sha, limit=""):
    summaries = [load(p) for p in sorted(pathlib.Path(folder).glob("cost-*.json"))]
    if not summaries:
        return
    head = f"{MARKER}\n### Cost estimate:"
    if any(s["error"] for s in summaries):
        print(f"{head} ❌ didn't finish, see the job log ({sha[:7]})")
        return
    currency = summaries[0]["currency"]
    before = sum(s["before"] for s in summaries)
    after = sum(s["after"] for s in summaries)
    change = after - before
    cap = num(limit)
    over = bool(cap) and after > cap
    if over:
        status = f"⚠️ {money(after, currency)}/month, above the {money(cap, currency)} limit"
    elif abs(change) < CENT:
        status = f"✅ no cost change, {money(after, currency)}/month"
    else:
        status = f"✅ {money(after, currency)}/month"

    def icon(delta):
        return "🔴 " if delta > 0 and over else "🟡 " if delta > 0 else "🔵 " if delta < 0 else ""

    print(f"{head} {status} ({sha[:7]})\n")
    print("| Before | After | Change |\n|--:|--:|--:|")
    delta = f"{icon(change)}{money(change, currency, sign=True)}" if abs(change) >= CENT else "–"
    print(f"| {money(before, currency)} | {money(after, currency)} | {delta} |")
    many = len(summaries) > 1
    drivers = sorted(
        ((s["unit"], d) for s in summaries for d in s["drivers"]), key=lambda x: -abs(x[1]["delta"])
    )
    if drivers:
        print("\n**What this PR changes**")
        for unit, d in drivers[:3]:
            name = f"{unit}/{d['address']}" if many else d["address"]
            tip = f". Consider: {d['hint']}" if d["hint"] else ""
            print(f"- {icon(d['delta'])}{money(d['delta'], currency, sign=True)} `{name}`{tip}")
    print("\nExcludes usage, such as model tokens, data transfer and logs.")


if __name__ == "__main__":
    # The comment has emoji; a Windows console defaults to a code page without them.
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    if sys.argv[1] == "parse":
        parse(*sys.argv[2:6])
    else:
        comment(*sys.argv[2:5])
