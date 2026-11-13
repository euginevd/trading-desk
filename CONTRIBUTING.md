<div align="center">

# Contributing

**Every change, by a person or a coding agent, goes through the same checks. The project's profile sets how much planning and approval it needs.**

[Setup](#setup) · [Making a change](#making-a-change) · [Pull requests](#pull-requests)

</div>

## Setup

1. `bash scripts/setup.sh`, once per clone: installs the tools and the pre-push scan. `--check` reports what's missing.
2. Read [AGENTS.md](AGENTS.md) and [docs/code-standards.md](docs/code-standards.md). They're the rules for agents and people alike.

## Making a change

1. Start from the spec: a change it doesn't cover starts with an update to [docs/spec.md](docs/spec.md).
2. Follow the project's profile: [guides/01-using-the-template.md](guides/01-using-the-template.md), section 4 for a `prototype`, section 5 for `production`.
3. Never push to `main` or skip the pre-push scan.

## Pull requests

1. One PR per branch, holding a work session's changes, filled in from the template, including its **Security** line.
2. Every check passes and the security summary is clean; fix findings at their cause.
3. Update the branch if `main` has moved, then squash-merge: once approved in a `production` project, once checks pass in a `prototype`, where the agent merges without asking.

Security issues go through [SECURITY.md](SECURITY.md), never a public issue or PR. [MIT licence](LICENSE).
