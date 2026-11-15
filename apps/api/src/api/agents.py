"""The desk's agents (decision 52): six personas and "Ask the desk", each with its own thread.
Every agent reads the owner's Plan and must say when a suggestion would break one of its rules.
For now each replies with a placeholder; `instructions` is what each will be given.
"""

import json
import time
from typing import Any

from api.audit import Audit
from api.store import Store
from api.trading import Refused
from api.trading_plan import for_agents

PERSONAS: dict[str, tuple[str, str]] = {
    "desk": ("Ask the desk", "the desk as a whole: route the question to whichever view fits"),
    "portfolio": ("Portfolio Manager", "allocation against the targets, sizing and rebalancing"),
    "technical": ("Technical Analyst", "price structure, levels, trend and momentum"),
    "macro": ("Macro & News", "rates, liquidity, regulation and the news that moves crypto"),
    "risk": ("Risk Officer", "the rules, concentration, drawdowns and what could go wrong"),
    "onchain": ("On-chain & Tokenomics", "supply, unlocks, staking, flows and holders"),
    "tax": ("Tax & Records (AU)", "Australian records and the tax effect of a trade, not advice"),
}
KEPT = 100
LONGEST = 1000


def _key(agent: str) -> str:
    return f"agent_thread_{agent}"


def _check(agent: str) -> str:
    if agent not in PERSONAS:
        raise Refused("No such agent.")
    return agent


def listing() -> dict[str, Any]:
    return {"agents": [{"id": key, "name": name} for key, (name, _) in PERSONAS.items()]}


def thread(store: Store, agent: str) -> dict[str, Any]:
    name = PERSONAS[_check(agent)][0]
    return {"id": agent, "name": name, "messages": json.loads(store.setting(_key(agent), "[]"))}


def send(store: Store, audit: Audit, agent: str, body: dict[str, Any]) -> dict[str, Any]:
    """Adds the owner's message and the agent's reply, a placeholder for now."""
    name = PERSONAS[_check(agent)][0]
    text = " ".join(str(body.get("text", "")).split())[:LONGEST]
    if not text:
        raise Refused("Write a message first.")
    now = int(time.time() * 1000)
    who = "The desk" if agent == "desk" else name
    messages: list[dict[str, Any]] = json.loads(store.setting(_key(agent), "[]"))
    messages += [
        {"role": "owner", "text": text, "time": now},
        {"role": "agent", "text": f"{who} will answer here soon.", "time": now},
    ]
    store.set_setting(_key(agent), json.dumps(messages[-KEPT:]))
    audit.record("agent", f"Message to {name}", "Placeholder reply")
    return thread(store, agent)


def instructions(store: Store, agent: str) -> str:
    """What the agent will be told: its role, the Plan, and the duty to flag a broken rule."""
    name, role = PERSONAS[_check(agent)]
    return (
        f"You are the {name} on the owner's personal crypto trading desk, covering {role}. "
        "Advice only: you never place, change or cancel an order. "
        "The owner's Plan below is the source of truth. Read its goals, strategy, rules and "
        "lessons before answering, and say plainly when a suggestion would break one of its "
        "rules, naming the rule. Quote only from its quotes, never invent one.\n"
        f"Plan: {json.dumps(for_agents(store))}"
    )
