# Using the template

How to take a project from an empty repo to a deployed app with your coding agent: what you say, what the agent does, and what you decide. For developers; the agent works from [AGENTS.md](../AGENTS.md), and the prompts in italics are only suggestions. Every file: [02-the-files.md](02-the-files.md). Accepted risks: [03-security-trade-offs.md](03-security-trade-offs.md). Each guardrail: [04-the-guardrails.md](04-the-guardrails.md).

## 1. Pick a profile

The agent asks for this first ([AGENTS.md](../AGENTS.md) rules 11 to 13). Where each profile stops for you is the gate table in rule 12; section 4 is the prototype's path and section 5 is production's.

| | `prototype`: a working MVP, fast | `production`: gated |
|---|---|---|
| For | No real users, customer data or payments | Anything that has them |
| You approve | Nothing: review whenever you like | Kickoff and every plan; a second reviewer approves each PR and each apply, `dev` and `prod` |
| Environments | `dev` only | `dev`, then `prod`, each in its own account |
| Tests | Main paths and anything sensitive, 50% coverage | Abuse cases too, 80% coverage |
| When unsure | The agent takes the simpler option and says so | The agent asks |
| Trade-offs | All accepted | Each fixed, or accepted by a named person |

In both, one branch holds a session's work. A prototype's agent commits, pushes, opens the PR and merges on its own; in production it does each only when you ask. It runs local commands itself and gives you cloud commands as bash for AWS CloudShell; what it asks first and never does is in [AGENTS.md](../AGENTS.md) rules 22 to 28.

## 2. Set up the repo

Once per project, by you. Steps 1 to 3 need the GitHub CLI, signed in with `gh auth login`.

1. **Create it:** `gh repo create <name> --template euginevd/sdlc-template --private --clone`. Keep a repo that deploys to AWS private: on a public one, anyone signed in can download `main`'s Terraform plans for a day (trade-offs 5). A private repo needs a paid GitHub plan (Pro or Team) for step 3.
2. **Tools and hooks:** `bash scripts/setup.sh` on every fresh clone installs the scanners, uv, Terraform and the push hook: with winget on Windows, Homebrew on macOS, and checked downloads on Linux, where an agent in a cloud container runs it itself. Until it runs, pushes aren't scanned; `bash scripts/setup.sh --check` only reports.
3. **Protect `main`:** `bash scripts/protect-main.sh` sets the Actions limits, squash-only merges, security features, the `main` ruleset and the `aws-dev-apply` environment, which deploys from `main` only. On a free plan a private repo gets neither the ruleset nor the environment, so nothing is enforced and the script says so; a public one also needs everything under Settings → Advanced Security turned on by hand ([guide 04](04-the-guardrails.md), sections 4 and 7).
4. **AWS, when the project first needs it:** follow the steps at the top of [bootstrap.yaml](../infra/aws/bootstrap/bootstrap.yaml), once per account: `dev`, and for production `prod` (`Target=prod`) before its first release. Set `BudgetEmail` for spend alerts and `INFRACOST_API_KEY` for a cost comment on each PR; `protect-main.sh` has already limited each `aws-<env>-apply` environment to `main`; run it again to check ([guide 04](04-the-guardrails.md), section 16).
5. **Reviewers**, the one step that differs by profile:
   - `prototype`: none. Leave the reviewer off `aws-dev-apply`, so a merge deploys to `dev` unattended.
   - `production`: give a second reviewer write access, run `bash scripts/protect-main.sh production`, and make them the required reviewer on each apply environment, with *Prevent self-review* on.
6. Keep `AGENTS.md`, `code-standards.md`, the workflows and the scripts as they are.

## 3. Kick off

Gate G0, once per project. `docs/` starts by describing the health-check API the template ships, with a *(to fill in)* line for each thing you decide. A prototype's agent fills them all in and keeps going; the *You* column is production's, and optional for a prototype. Once a profile is set, CI's `kickoff` check fails while any *(to fill in)* line is left.

| You say | The agent | You |
|---------|-----------|-----|
| *"Kick off `<name>`: `<notes on the business, problem, users and stack>`"* | Checks the machine, asks the profile, drafts `spec.md` with its Business section | Correct it until it's right |
| | Runs a short spike on the deploy target: what each managed service refuses or limits, into `decisions.md` | Agree the target |
| | With UI: drafts `design-system.md` and mocks up the MVP's main screens in `docs/mockups/mvp.html` | Open the mockup; ask for changes, then approve |
| | Extends `threat-model.md` and `costs.md`; a prototype keeps the starter's | `production`: approve each |
| | Records the profile, accepted trade-offs and code owner in `decisions.md` | Say which trade-offs you accept |
| *"Rename the project"* | Renames the README, `spec.md` and `pyproject.toml` (then `uv lock`); a prototype sets `fail_under = 50` | Replace `LICENSE` and `guides/assets/`; a private project deletes `CONTRIBUTING.md` and `social.png` |
| *"Commit and push"*, production only | Opens one PR with all of it | Approve it, and the agent merges. A prototype's agent does this unasked |

## 4. Build a prototype

One prompt builds and ships. Nothing waits for you: the agent decides what production would ask about, records it in `decisions.md`, and tells you in its report.

| You say | The agent | You |
|---------|-----------|-----|
| *"Build `<the work>`"* | Adds it to the spec, writes a short plan and builds on the session's one branch: code, main-path tests, local checks, `features.md` and `TODO.md` | Interrupt if the direction is wrong |
| | New cloud service: deploys a walking skeleton to `dev` first, one service at a time ([AGENTS.md](../AGENTS.md) rule 17) | |
| | A fresh subagent reviews the whole branch; it fixes what it blocks and reports | Try it; ask for more |
| | Once the work is done and the local checks pass: commits, pushes (the pre-push scan runs), opens one PR, fixes the findings and squash-merges once checks pass | |
| | The pipeline deploys to `dev`; first-deploy fixes stay on one branch until green, then it smoke-tests | Try it in `dev` |
| | The day after a deploy, compares actual cost with `costs.md` | Read the report |

It still stops before spending past the monthly limit in spec 10, before weakening its own floor (never touching AWS directly, secrets, hooks or attribution), and before real users, customer data or payments. A check that fails three times goes into `TODO.md` as blocked while it moves on. Ask for more whenever you want it: *"review the plan with me first"*, *"add a threat model"*, *"wait for me before merging"*.

## 5. Build for production

The same loop, stopping at gates G1 to G4 ([AGENTS.md](../AGENTS.md) rule 12). The ↺ marks a step the agent repeats until it's clean.

| # | Gate | You say | The agent | You |
|:-:|------|---------|-----------|-----|
| 1 | G1 Plan | *"Plan `<the work>`"* | Updates the spec, writes the plan, the threat model and any mockups; no code, then stops | ↺ Ask for changes, then approve |
| 2 | Build | *"Implement the plan"* | Builds each phase on one branch: abuse-case tests, local checks, a fresh review per phase | |
| 3 | G2 PR | *"Commit and push"* | Pushes, opens a PR with its Security line, ↺ fixes what the checks find, then asks for review | The second reviewer approves |
| 4 | G3 `dev` | *"Merge it"* | Squash-merges; the pipeline plans `dev` and waits; once applied, the agent smoke-tests and reports | The second reviewer approves the apply |
| 5 | G4 Release | | Confirms the checklist's production rows are done | Run `gh workflow run aws.yml -f target=prod`; the second reviewer approves it |
| 6 | G5 After | | The next day, checks actual cost and the alarms | Anything raised starts at step 1 |

## 6. Other changes

| When | You say | What happens |
|------|---------|--------------|
| A small fix touching no users, data, auth, endpoints, infrastructure or screens | *"Fix `<the problem>`"* | No plan, the same checks |
| Dependabot's weekly PRs | *"Check the Dependabot PRs"* | The agent fixes what the checks find |
| A scan on `main` or the weekly scan fails | *"Fix the failed scan on main"* | The agent fixes each finding at its cause |
| A new AWS service | Production: answer when the agent asks. A prototype's agent decides | It adds the permissions to `bootstrap.yaml`; you redeploy the stack before the merge |
| The agent got something wrong | Tell it | It adds a line, or better a check, to `docs/known-mistakes.md` |

## 7. From prototype to production

Say *"Make this project production"*, and the agent does steps 1 to 3 on one branch:

1. `Profile` in `spec.md` becomes `production`, with a new decision.
2. It extends the threat model and costs for you to approve.
3. `fail_under` goes back to 80, and it adds the skipped tests, abuse cases included.
4. You go through the trade-offs: each gets its fix, or a named person accepts it.
5. You set up the reviewers (section 2, step 5) and bootstrap the `prod` account.
