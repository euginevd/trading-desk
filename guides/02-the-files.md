# The files

A tour of a project made from [euginevd/sdlc-template](https://github.com/euginevd/sdlc-template): the layout, then one line per file. For people; how to run a project is in [01-using-the-template.md](01-using-the-template.md).

```
my-project/
├── pyproject.toml   uv.lock   .python-version     1. Python packages
├── README.md   AGENTS.md   CONTRIBUTING.md  …      2. docs for people and agents
├── docs/   guides/
├── .gitignore   .gitattributes                     3. git and ignore files
├── lefthook.yml   .lefthook/   scripts/            4. local tools
├── .vscode/   .editorconfig
├── apps/                                           5. app code, one folder per app
├── .github/                                        6. CI/CD
└── infra/aws/                                      7. cloud
```

## 1. uv (Python packages)

1. **pyproject.toml**: packages, Python version and tool settings (ruff, pyright, pytest).
2. **apps/api/pyproject.toml**: the api's own settings; shares the root lock and `.venv`.
3. **.python-version**: pins Python 3.13.
4. **uv.lock**: exact versions and hashes, so every install is identical. Never edit.
5. **.venv/**: installed packages; git-ignored, rebuilt with `uv sync`.

## 2. Docs (.md files)

1. **README.md**: the GitHub front page.
2. **CONTRIBUTING.md**: how a person or agent sets up and makes a change.
3. **AGENTS.md**: the rules every coding agent follows, with the gates for each profile; changes rarely. Kept short, as every session reads it.
4. **docs/**: the project context agents read and keep current:
   1. **spec.md**: the business, then problem, users, stack, done-when and rules; the agent drafts, you approve (production).
   2. **code-standards.md**: numbered coding rules the pipeline can't check, including the length of docs.
   3. **features.md**: each feature by app, with its status and PR.
   4. **decisions.md**: the decisions in force, why, and what they replaced.
   5. **known-mistakes.md**: mistakes an agent has made, each with its fix, by area; the agent reads an area's before working in it.
   6. **design-system.md**, **threat-model.md**, **costs.md**: UI, risks and spend; optional.
   7. **checklist.md**: the guardrails by DevSecOps stage and profile, to clear before go-live.
   8. **skeleton-plan.md**: the outline each plan is copied from.
   9. **plan-\<name\>.md**, **mockups/\<name\>.html**: the plan being built and its screens; deleted when done.
   10. **mockups/mvp.html**: the MVP's screens from kickoff; deleted once all are built.
5. **guides/**: for people: 01 using the template, 02 this tour, 03 accepted risks, 04 each guardrail, 05 removing a project from AWS. `assets/` holds the README's images, `flow.html` that renders them, and `social.png`.
6. **SECURITY.md**: how to report a vulnerability privately.
7. **LICENSE**: MIT; replace it per project.
8. **TODO.md**: your inbox of ideas and tasks; in production the agent confirms before starting one, a prototype's just starts.

## 3. Git and ignore files

1. **.git/**: git's own database; never edit by hand.
2. **.gitignore**: what git never tracks: secrets (`.env*`, `*.tfvars`), Terraform state, build output, caches.
3. **.gitattributes**: keeps LF on `.sh` so bash works on Windows; collapses lock files in PR diffs.

## 4. Local tools (hooks, editor, scripts)

The push scan: `setup.sh` runs `lefthook install`, which writes `.git/hooks/pre-push`; each `git push` then runs `pre-push-scan.sh`, which passes or blocks.

1. **scripts/setup.sh**: once per clone, on Windows, macOS or Linux: installs the tools and hooks, then `uv sync`; `--check` only reports.
2. **lefthook.yml**: which script runs on which git event: a scan before every push.
3. **.git/hooks/pre-push**: hidden and per clone, written by `lefthook install`.
4. **.lefthook/pre-push-scan.sh**: scans the pushed commits with gitleaks (secrets) and Trivy (packages, IaC); a finding blocks the push.
5. **.vscode/extensions.json**: suggests the scanner, Ruff, Python and Terraform extensions.
6. **.editorconfig**: LF, UTF-8, indent size and a final newline.
7. **.claude/settings.json**: Claude Code's shared settings: no AI attribution on commits or PRs, and deny rules for force-pushes, skipped hooks, Terraform applies and `.env` reads. Local settings and worktrees are git-ignored.
8. **scripts/protect-main.sh**: once, by hand: locks `main`, squash-only merges, security features, apply environments that take `main` only; `production` adds a second reviewer.
9. **scripts/pr-findings.sh**: lists a PR's failed checks, security summary, open threads and alerts; replies and resolves threads.
10. **scripts/security-report.py**: CI: scanner results as PR annotations and one summary comment.
11. **scripts/cost-report.py**: CI: Infracost results as PR annotations and one cost comment.
12. **scripts/tests/**: tests for the two report scripts; they run with the apps' tests.

## 5. App code

One folder per app in `apps/`: Python has `pyproject.toml`, `src/<name>/` and `tests/`; Node has `package.json`, `src/` and `tests/`.

1. **apps/api/src/api/handler.py**: the function Lambda calls for each request.
2. **apps/api/src/api/\_\_init\_\_.py**: empty; marks the folder as a package.
3. **apps/api/src/api/py.typed**: empty; tells pyright the package has types, or strict mode fails its imports.
4. **apps/api/tests/test_handler.py**: two tests: one that it works, one that it's safe.
5. **.coverage**, **.pytest_cache/**, **.ruff_cache/**, **\_\_pycache\_\_/**: git-ignored tool output; safe to delete.

Tests run with `uv run pytest` locally, or in CI on every PR. They fail on any failed test, or on coverage under `fail_under` (80%, or 50% for a prototype).

## 6. CI/CD (.github/)

A change ships like this: PR → `ci`, `security` and `codeql` run → `aws` plans → review → merge → `aws` deploys `dev`.

1. **pull_request_template.md**: pre-fills each PR: what changed, security, checks.
2. **CODEOWNERS** *(not included)*: requests reviewers per path; add it once a team shares the repo.
3. **dependabot.yml**: weekly update PRs for actions, Python and Terraform, each release 7 days old.
4. **workflows/ci.yml**: lint, types and tests for only the apps a PR changes; actionlint, zizmor and shellcheck when workflows or scripts change; and the `kickoff` check for leftover *(to fill in)* lines and docs over their length.
5. **workflows/security.yml**: the push scan again, plus Checkov, Semgrep and `terraform validate`; weekly too.
6. **workflows/codeql.yml**: GitHub's code scanning on PRs, `main` and weekly.
7. **workflows/aws.yml**: Terraform plan and cost on PRs, with one `plan-result` check the ruleset requires; on merge, applies the changed units to `dev`, and `prod` by hand.
8. **workflows/images.yml**: builds, scans and pushes each app's image to ECR, with its SBOM; idle until an app has a Dockerfile.

## 7. Cloud (infra/aws/)

Bootstrap once by hand; then `aws.yml` plans the changed units on PRs and applies them after merge.

1. **bootstrap/bootstrap.yaml**: CloudFormation, by hand once per account: GitHub sign-in, roles (a read-only troubleshoot one and its CLI user among them), state bucket and the budget alert.
2. **`<unit>/`**: one Terraform folder per deployable unit (such as `api/`), each with its own state:
   1. **versions.tf**: pins Terraform and the providers.
   2. **variables.tf**: inputs (project, environment, region), set by the pipeline.
   3. **main.tf**: the unit's resources, such as Lambda, API Gateway, roles and logs.
   4. **outputs.tf**: values printed after a deploy, such as a URL.
   5. **.terraform.lock.hcl**: exact provider versions and hashes. Never edit.
