# Security trade-offs

The risks the template accepts for speed, each with its production fix. Numbered so reviews can cite them (trade-offs 1); a fixed risk keeps its number and says so. An accepted risk is a decision: change it here, never by weakening a check.

The profile decides what happens to them ([AGENTS.md](../AGENTS.md) rules 11 to 13). A `prototype` accepts them all. `production` applies each fix, or records in `decisions.md` who accepts the risk; 12 and 13 never apply to it.

| # | Risk | Why it's a risk | Production fix |
|:-:|------|-----------------|----------------|
| 1 | The agent shares the developer's GitHub identity | With the developer's token it could merge its own PR, approve its own deploy or delete the ruleset; only `AGENTS.md` rules 16 and 25 ask it not to | A second reviewer: `bash scripts/protect-main.sh production`, and *Prevent self-review* on the apply environments |
| 2 | The agent's rules are only partly enforced on the machine | `.claude/settings.json` denies the usual spellings of a force-push, `--no-verify`, `terraform apply` and `destroy`, and `.env` reads, but a rule matches how a command is written, so a reworded one slips past; other agents don't read it, and a prototype drops the `.env` rules | A sandbox or a separate OS account for the agent; secrets in a vault |
| 3 | Pinned tools go stale | Dependabot doesn't update digest-pinned images, `TF_VERSION` or local tools, so they miss newer checks | Renovate with the same 7-day wait; until then, update by hand when changing a workflow |
| 4 | The deploy role is broad in two places | `apigateway:*` covers every API in the region, and log delivery needs `*`, so in a shared account it reaches other workloads | A dedicated AWS account per project and environment |
| 5 | Plans run unreviewed code and are kept as files | A PR's plan runs before review and can read state. A PR's plan isn't kept, but `main`'s saved plan holds state in plain text for a day | A private repo, a reviewer on the plan environments, and encrypted plans |
| 6 | *Fixed:* a failing Terraform plan could merge | `aws.yml` now runs on every PR and its `plan-result` check is required by `protect-main.sh` | |
| 7 | A PR's checks cover only what it changes | Scans and app jobs run only on what changed, so a new rule matching old code fails only non-blocking runs on `main` and weekly | Alerts on failed `main` and weekly runs, fixed like a failed PR; review the `changes` job's paths when the layout changes |
| 8 | Some checks are missing | Workflows and scripts are linted (actionlint, zizmor, shellcheck) and the report scripts are tested, but Terraform isn't linted and there's no evals job | tflint as a required check; an evals job once an app calls a model |
| 9 | CodeQL needs a paid plan on private repos | On a private repo without Code Security, Semgrep is the only SAST | Buy Code Security, or accept Semgrep alone in `decisions.md` |
| 10 | Cost is a warning, not a gate | The cost comment doesn't block and prices only resources; the budget emails late and stops nothing | A required cost check, Cost Anomaly Detection, and a budget per project through cost tags |
| 11 | *Fixed:* nothing checked kickoff was finished | CI's `kickoff` check fails on a *(to fill in)* line in `docs/` once `spec.md` names a profile | |
| 12 | A prototype runs without human gates | Nobody approves its spec, plan, merges or `dev` deploys; the agent settles unclear points, adds AWS services and cost up to the monthly limit, and changes rules above the floor itself (`AGENTS.md` rules 12, 21 and 22) | The `production` profile, with the reviewer in 1 |
| 13 | A prototype is lightly tested | Main paths only, one review per branch and no threat model unless asked (`AGENTS.md` rule 15), so edge cases surface late | Before `production`: a threat model, abuse-case tests, 80% coverage and a review per phase |
| 14 | The troubleshoot role's key is long-lived | The `<project>-cli` user's access key sits on the developer's machine, where the agent uses it. It can only assume a read-only role, which in `dev` reads data too; outside `dev` it reads logs and settings, not stored data, secrets or function code | IAM Identity Center sign-in in place of the user; until then rotate the key, and delete it when nobody is troubleshooting |
