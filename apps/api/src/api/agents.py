"""The desk's agents (decisions 52 and 59): a team of five, each a person with a name, a job
title and a remit. The Coordinator is the owner's first stop and manages the four specialists,
after the analyst-team-under-a-manager shape of multi-agent trading research. Every agent reads
the owner's Profile (decision 58) and must say when a suggestion would break one of its rules.
For now each replies with a placeholder; `instructions` is what each will be given.
"""

import json
import time
from dataclasses import dataclass
from typing import Any

from api.audit import Audit
from api.profile_md import for_agents
from api.store import Store
from api.trading import Refused


@dataclass(frozen=True)
class Persona:
    name: str
    title: str
    remit: str  # one line for the card
    role: str  # what the agent covers, for its instructions
    reports_to: str | None  # an agent id; None reports to the owner


# The ids are kept from decision 52 where the role carries on, so threads survive.
PERSONAS: dict[str, Persona] = {
    "desk": Persona(
        "Morgan",
        "Desk Coordinator",
        "Ask anything. Pulls in the specialists and brings back one answer.",
        "the desk as a whole: answer general questions, and for anything specialist ask the "
        "Risk Officer, Market Researcher, Technical Analyst or Tax Specialist and combine "
        "their views into one answer, saying who said what",
        None,
    ),
    "risk": Persona(
        "Riley",
        "Risk Officer",
        "Portfolio health, risk limits and discipline against your Profile.",
        "portfolio health, concentration, drawdowns, allocation against the Strategy, and the "
        "discipline of keeping to the Profile's rules",
        "desk",
    ),
    "research": Persona(
        "Quinn",
        "Market Researcher",
        "Sentiment, news, macro and on-chain: what's moving the market.",
        "market sentiment, news, rates and liquidity, regulation, and on-chain flows",
        "desk",
    ),
    "technical": Persona(
        "Kai",
        "Technical Analyst",
        "Charts, levels, trend and momentum for any coin.",
        "price structure, support and resistance, trend and momentum",
        "desk",
    ),
    "tax": Persona(
        "Ellis",
        "Tax Specialist (AU)",
        "Australian records and the tax effect of a trade. Not tax advice.",
        "Australian records, CGT lots and the 12-month discount, and the tax effect of a "
        "trade; general information, not tax advice",
        "desk",
    ),
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
    return {
        "agents": [
            {
                "id": key,
                "name": p.name,
                "title": p.title,
                "remit": p.remit,
                "reportsTo": p.reports_to,
            }
            for key, p in PERSONAS.items()
        ]
    }


def thread(store: Store, agent: str) -> dict[str, Any]:
    p = PERSONAS[_check(agent)]
    messages = json.loads(store.setting(_key(agent), "[]"))
    return {"id": agent, "name": p.name, "title": p.title, "messages": messages}


def send(store: Store, audit: Audit, agent: str, body: dict[str, Any]) -> dict[str, Any]:
    """Adds the owner's message and the agent's reply, a placeholder for now."""
    name = PERSONAS[_check(agent)].name
    text = " ".join(str(body.get("text", "")).split())[:LONGEST]
    if not text:
        raise Refused("Write a message first.")
    now = int(time.time() * 1000)
    messages: list[dict[str, Any]] = json.loads(store.setting(_key(agent), "[]"))
    messages += [
        {"role": "owner", "text": text, "time": now},
        {"role": "agent", "text": f"{name} will answer here soon.", "time": now},
    ]
    store.set_setting(_key(agent), json.dumps(messages[-KEPT:]))
    audit.record("agent", f"Message to {name}", "Placeholder reply")
    return thread(store, agent)


def instructions(store: Store, agent: str) -> str:
    """What the agent will be told: its role, the Profile, and the duty to flag a broken rule."""
    p = PERSONAS[_check(agent)]
    boss = PERSONAS[p.reports_to].name if p.reports_to else "the owner"
    return (
        f"You are {p.name}, the {p.title} on the owner's personal crypto trading desk, "
        f"covering {p.role}. You report to {boss}. "
        "Advice only: you never place, change or cancel an order. "
        "The owner's Profile below is the source of truth. Read its goals, foundations, "
        "strategy, rules and lessons before answering, and say plainly when a suggestion would "
        "break one of its rules, naming the rule. A rule marked Not set is no rule: never "
        "enforce it.\n"
        f"Profile:\n{for_agents(store)}"
    )
