# The guardrails

How each control in [docs/checklist.md](../docs/checklist.md) works, numbered to match. The risks the template accepts instead are in [03-security-trade-offs.md](03-security-trade-offs.md).

Terms: SCA finds vulnerable packages; SAST finds flaws in your own code; DAST attacks the running app; IaC is Terraform and CloudFormation. The same scans run before a push and on the PR on purpose: the hook can be skipped, the required checks can't.

## 1. Plan: threat modelling and security requirements

**Tool:** `docs/threat-model.md`, and the spec's Rules with an OWASP ASVS level. **Profile:** production; a prototype only if asked.

- **Does:** lists what a change touches, classifies the data and works through STRIDE, mapping each risk to OWASP. The spec sets ASVS level 1 for a prototype, 2 for production.
- **When:** at kickoff, and in each plan touching users, data, auth or endpoints.
- **On a finding:** each risk gets a control and a test; you approve before any code.
- **Limits:** only as good as the review. Each data class still needs its own encryption, backups and retention, set per project.

## 2. Plan: cost estimate

**Tool:** `docs/costs.md`. **Profile:** production; a prototype keeps the starter's.

- **Does:** estimates each environment's monthly cost by service, against a monthly limit.
- **When:** at kickoff, and whenever a plan adds a service or cost (AGENTS.md rule 22).
- **On a finding:** you approve the estimate or change the plan.
- **Limits:** an estimate, not a bill; data transfer and model tokens are hardest to predict.

## 3. Code, IDE: secrets, SCA and IaC scanning

**Tool:** Gitleaks and Trivy, in `.lefthook/pre-push-scan.sh`. **Profile:** both.

- **Does:** Gitleaks finds secrets. Trivy finds vulnerable packages, insecure infrastructure settings and secrets.
- **When:** on every `git push`, over every pushed commit and its history; `setup.sh` installs the hook.
- **On a finding:** the push is blocked. Trivy blocks only fixable high and critical findings.
- **Limits:** it runs on your machine, so it can be skipped. Rotate any secret that gets past it.

## 4. Code, repo: push protection and SCA

**Tool:** GitHub push protection and Dependabot, turned on by `bash scripts/protect-main.sh`. **Profile:** both.

- **Does:** GitHub rejects a push containing a known secret pattern, even when the hook was skipped. Dependabot alerts on vulnerable or malicious packages and opens grouped fix PRs.
- **When:** on every push; alerts as advisories publish, and weekly update PRs per ecosystem.
- **On a finding:** the push is rejected, or an alert appears with a fix PR.
- **Limits:** turn on malware alerts and grouped security updates by hand (Settings → Advanced Security). Generic passwords need paid Secret Protection; Gitleaks covers them. Turn on 2FA and personal push protection.

## 5. Code, agent: agent guardrails

**Tool:** `AGENTS.md`, the agent tool's permission settings, and for production the agent's own GitHub account. **Profile:** both.

- **Does:** `AGENTS.md` holds the rules every agent reads (rules 25 and 26: never touch secrets, cloud resources or hooks). `.claude/settings.json` enforces what Claude Code can: it denies force-pushes, `--no-verify`, `terraform apply` and `destroy`, and `.env` reads (a prototype drops the last at kickoff), and turns off AI attribution on commits and PRs (rule 29).
- **When:** in every session.
- **On a finding:** hooks and required checks catch a broken rule; add a known mistake to `docs/known-mistakes.md`.
- **Limits:** deny rules match how a command starts, so a reworded command can slip past; other agents need their own settings (trade-offs 2). The only AWS key on the agent's machine is the read-only troubleshoot user's (trade-offs 14); while it works as you on GitHub, its actions look like yours (trade-offs 1).

## 6. Build: secrets, SCA and IaC scanning

**Tool:** Gitleaks, Trivy and Checkov, in `.github/workflows/security.yml`. **Profile:** both.

- **Does:** the pre-push scans again, plus Checkov and `terraform fmt` and `validate`.
- **When:** on every PR, on `main` and weekly, so a vulnerability published after a merge still fails a run.
- **On a finding:** a required check fails; findings are marked on the PR and listed by `bash scripts/pr-findings.sh <pr>`.
- **Limits:** scans files, not images; the `images` workflow scans each built image before it reaches ECR.

## 7. Build: SAST

**Tool:** Semgrep (`security.yml`), CodeQL (`codeql.yml`), and GitHub AI Scan, set by hand. **Profile:** both.

- **Does:** Semgrep matches known bad patterns in seconds. CodeQL traces data across files to find injection and path traversal.
- **AI Scan and Copilot Autofix** (Settings → Advanced Security): AI Scan comments on PRs in languages CodeQL skips and looks for prompt injection in LLM code. Autofix suggests or opens a fix PR, which goes through the same checks; these use AI credits and don't block a merge.
- **When:** on every PR (Semgrep only new findings), on `main` and weekly; CodeQL skips docs-only PRs.
- **On a finding:** Semgrep fails a required check; CodeQL adds an alert on the PR's lines.
- **Limits:** CodeQL is free on public repos only (trade-offs 9).

## 8. Build: supply chain security

**Tool:** pins in the workflows, `exclude-newer` in `pyproject.toml`, `cooldown` in `dependabot.yml`, and the `sbom` job. **Profile:** both.

- **Does:** actions are pinned by commit and images by digest. Packages wait 7 days before use, unless a release fixes a named vulnerability (AGENTS.md rule 24). Trivy builds a CycloneDX SBOM from the lock files.
- **When:** pins and the wait on every install; the SBOM on every push to `main`.
- **On a finding:** nothing fails; these prevent. The SBOM is under the `main` run's Artifacts.
- **Limits:** the SBOM isn't signed and GitHub deletes it after 90 days; for production, keep it with a release or in S3. Signing, SLSA provenance and a licence policy aren't in the template yet.

## 9. Test: unit and abuse-case tests, coverage

**Tool:** pytest with ruff and pyright, in `.github/workflows/ci.yml`. **Profile:** both; the bar differs.

- **Does:** production tests every change with abuse cases at 80% coverage. A prototype tests main paths and anything touching auth, money or personal data, at 50%.
- **When:** on every PR that changes an app, as a required check.
- **On a finding:** a failed test, or coverage under `fail_under`, blocks the merge.
- **Limits:** tests run the code, not the deployed app. AI evals aren't in CI yet (trade-offs 8).

## 10. Test: DAST, unauthenticated

**Tool:** OWASP ZAP's baseline scan, per project. **Profile:** production.

- **Does:** passively scans the running app for missing headers, verbose errors, open redirects and bad CORS or TLS, in about a minute.
- **When:** after each apply to `dev`, in the `aws` workflow; ZAP's API scan once there's an OpenAPI spec.
- **On a finding:** high risks block the `prod` deploy; the rest go in the run summary.
- **Limits:** not in the template yet; add it before go-live. It sees only the public surface.

## 11. Test: DAST, authenticated

**Tool:** OWASP ZAP with a test login, per project. **Profile:** production.

- **Does:** the same scan signed in, to find broken access control and session flaws.
- **When:** with 10, after each apply to `dev`.
- **On a finding:** as in 10.
- **Limits:** not in the template yet. Its test account lives in `dev` only, with credentials in an environment secret.

## 12. Release: branch protection

**Tool:** the `main` ruleset, set by `bash scripts/protect-main.sh`. **Profile:** both.

- **Does:** every change goes through a PR with required checks on an up-to-date branch, squash-only; `main` can't be force-pushed or deleted, even by an admin. The required checks include `plan-result`, so a failed Terraform plan blocks the merge; `kickoff`, so an unfinished kickoff does; and `workflows`, which lints workflows and scripts with actionlint, zizmor and shellcheck.
- **When:** on every push to `main` and every merge.
- **On a finding:** a direct push is rejected; merge stays disabled until checks pass.
- **Limits:** rulesets need a public repo or a paid plan.

## 13. Release: peer review

**Tool:** `bash scripts/protect-main.sh production`. **Profile:** production.

- **Does:** each PR needs one approval from someone other than its author, after the last push, with every thread resolved.
- **When:** on every PR to `main`.
- **On a finding:** the PR can't merge; a new push dismisses the approval.
- **Limits:** while the agent works as you, the reviewer must be another account. A prototype merges once checks pass.

## 14. Release: cost review

**Tool:** Infracost, the `cost-report` job in `aws.yml`. **Profile:** both.

- **Does:** comments each PR's monthly estimate, its change and the top cost drivers.
- **When:** on every PR that changes `infra/aws/`.
- **On a finding:** warns above `MONTHLY_COST_LIMIT`, without blocking.
- **Limits:** needs the bootstrap and a free `INFRACOST_API_KEY`. It prices resources, not usage (trade-offs 10).

## 15. Deploy: AWS account baseline

**Tool:** the account's own settings, set by you. **Profile:** both; production adds separate accounts.

- **Does:** root has MFA and no keys; people sign in through IAM Identity Center with short sessions. Production keeps `dev` and `prod` in separate accounts in one Organization.
- **When:** once per account, before the bootstrap.
- **On a finding:** IAM and Security Hub flag root without MFA or with keys.
- **Limits:** not in the template yet; the bootstrap assumes it.

## 16. Deploy: cloud identity and least privilege

**Tool:** GitHub OIDC and the roles in `infra/aws/bootstrap/bootstrap.yaml`. **Profile:** both.

- **Does:** only the pipeline touches AWS, through OIDC, with no stored keys. A read-only role plans; a deploy role held to a boundary applies. Each trusts only this repo and one environment; the state bucket is encrypted and private.
- **When:** on every `aws` workflow run.
- **On a finding:** a plan outside the roles fails in the pipeline.
- **Limits:** the deploy role trusts its `aws-<env>-apply` environment, so `protect-main.sh` creates each one taking `main` only, and fails on a rerun if one takes more; without that a PR editing `aws.yml` could deploy. The boundary caps grants, not every mistake.

## 17. Deploy: deploy approval

**Tool:** a required reviewer on each `aws-<env>-apply` environment. **Profile:** production.

- **Does:** holds every apply until a second reviewer approves it, after the plan and cost comment (AGENTS.md rule 12, G3 and G4).
- **When:** on every apply, `dev` and `prod`.
- **On a finding:** the reviewer rejects the run and nothing applies.
- **Limits:** a prototype leaves the reviewer off, so `dev` applies unattended; it has no `prod` (AGENTS.md rule 27).

## 18. Deploy: runtime secrets

**Tool:** Secrets Manager or SSM `SecureString`, per project. **Profile:** both.

- **Does:** runtime secrets live encrypted in AWS; each function's role reads only its own, at runtime. `.env` is for your machine only.
- **When:** from the first secret the app needs.
- **On a finding:** Checkov flags secrets in Terraform or Lambda environment variables; Gitleaks in code.
- **Limits:** not in the template yet. Never put a value in Terraform state or a Lambda variable; rotate on a schedule and after a leak.

## 19. Deploy: API protection

**Tool:** an API Gateway authoriser, AWS WAF, CORS and security headers, per project. **Profile:** production.

- **Does:** non-public endpoints need a signed-in caller: a JWT authoriser for users, IAM for services (known-mistakes 9). WAF blocks common attacks; CORS allows only your origins.
- **When:** on every request.
- **On a finding:** `401` unauthenticated, `403` blocked; DAST (10, 11) checks they hold.
- **Limits:** not in the template yet; `/health` is public by design. WAF costs monthly, so ask first (AGENTS.md rule 22).

## 20. Operate: weekly re-scans

**Tool:** weekly `security` and `codeql` runs, and Dependabot. **Profile:** both.

- **Does:** re-scans `main` so a newly published vulnerability or query still fails a run.
- **When:** early every Monday, Sydney time.
- **On a finding:** a failed run or an alert, blocking nothing until fixed (trade-offs 7).
- **Limits:** logs and artifacts go after 90 days, app logs after 30. Posture management (such as Prowler) isn't in the template yet.

## 21. Operate: budget alert

**Tool:** the AWS budget in `bootstrap.yaml`. **Profile:** both.

- **Does:** emails at 80% and 100% of `MonthlyBudgetUsd` in actual spend, and when the forecast passes 100%.
- **When:** as spend accrues.
- **On a finding:** an email; find the cause in Cost Explorer.
- **Limits:** exists only if `BudgetEmail` is set; alerts but doesn't stop spending (trade-offs 10).

## 22. Monitor: access logs and throttling

**Tool:** the HTTP API's access logs and throttling, and Lambda logs, from `infra/aws/api/`. **Profile:** both.

- **Does:** logs every request and run for 30 days, and caps the request rate.
- **When:** on every request.
- **On a finding:** throttled calls get `429`; investigate in CloudWatch.
- **Limits:** nothing watches the logs (see 23, 24); raise retention if an audit needs it.

## 23. Monitor: audit logging

**Tool:** AWS CloudTrail, per account. **Profile:** both.

- **Does:** records every AWS API call: who, what, when and from where.
- **When:** on every AWS API call.
- **On a finding:** search the console, or Athena for a trail in S3.
- **Limits:** not in the template yet. Event history keeps 90 days free; a trail to S3 keeps longer for storage cost.

## 24. Monitor: threat detection and alarms

**Tool:** Amazon GuardDuty and CloudWatch alarms, per account. **Profile:** production.

- **Does:** GuardDuty spots stolen credentials, mining and bad addresses. Alarms watch errors, `5xx`, throttling and latency.
- **When:** all the time.
- **On a finding:** follow the project's incident runbook: contain, rotate and restore.
- **Limits:** not in the template yet. GuardDuty costs after 30 days, so ask first (AGENTS.md rule 22).
