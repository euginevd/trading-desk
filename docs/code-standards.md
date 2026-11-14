# Code standards

How to write the code, numbered so reviews can cite them. `AGENTS.md` covers what to build and the workflow; these cover how.

## General

1. Keep it simple: the smallest change that meets the spec or plan, for cases that exist now. Measure before optimising.
2. Names say what; comments say why, in one line. No dead code, unused imports or compat shims.
3. Match the surrounding code, and use the framework's own way first, checked against the installed version's docs.
4. One job per module and per function. Each external service is reached through one module, the only place with its settings.
5. Write a literal once. Settings come from environment variables, validated at startup.

## Errors and logs

6. Handle an error only where you can do something useful with it; otherwise let it surface.
7. Fail closed: when a security or payment check can't complete, deny.
8. Log structured JSON with a request ID. Never log secrets or personal data; redact at the source.

## Safe by design

9. Validate every input at the boundary (API, files, queues) against a schema, and reject what doesn't match. Serve uploaded files with `Content-Security-Policy: default-src 'none'; sandbox`, never as a page.
10. Check authorisation on every request, on the server, and deny by default, internal services included: nothing reachable from the internet is left open because only our code calls it. Services trust each other through IAM roles and signed requests, not shared keys, and secrets never travel in payloads, URLs, logs or environment variables.

## Tests

11. Add tests with each change, including the abuse cases in `threat-model.md`. Stub models, cloud and paid services.
12. Keep test coverage at 80% or more; CI fails below it. A prototype's tests and coverage, in place of 11's abuse cases and this 80%: `AGENTS.md` rule 15.

## Terraform

13. One root per unit in `infra/aws/<unit>/`, copied from the starter's `infra/aws/api` (in git history before decision 14): `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf` and the lock file. Pin Terraform and providers; never commit state.
14. No hardcoded IDs, regions, ARNs, project names or environments. Name resources `${var.project}-<unit>-<what>-${var.environment}`, give every IAM role the `${var.project}-boundary` boundary, and tag through `default_tags`.

## Languages

15. Python: the newest version the deploy runtime supports, `uv run` for everything, `ruff` to lint and format, `pyright` in strict mode; one workspace member per app in the root `pyproject.toml`.
16. TypeScript: strict mode, never `any`; ESLint with `jsx-a11y` and Prettier; `save-exact=true` and `min-release-age=7` in the app's `.npmrc`. The server for web pages sends a strict CSP with `frame-ancestors 'none'`, `nosniff` and `no-referrer`.

## AI and agents

17. The model decides; deterministic code acts. Limits, payments and permissions are enforced in code, never in a prompt.
18. Model output and uploaded content are untrusted: keep content apart from instructions, ask for structured output, and validate it against a schema.
19. Every model call uses an explicit model ID (never "latest"), a timeout, a token limit and a retry cap.
20. Prompts and model settings live in the repo; changing them is a code change. Evals run in CI against a held-out answer set the agent never sees, plus a red-team set in `data/redteam/`: prompt-injection attacks, each with its OWASP ID. A case passes only when no action goes beyond what the input honestly supports.
21. Instructions give the goal, the inputs and what done looks like, not the steps.

## Containers

22. Images are multi-stage, pinned by digest, run as a non-root user and have a `HEALTHCHECK`; local ports bind to `127.0.0.1`; a missing setting fails at start (`${VAR:?}`), and `.env.example` lists each one. A `.dockerignore` keeps `.env*` and `.git` out of every image. An app's `Dockerfile` in `apps/<app>/`, built from the repo root, is picked up by the `images` workflow, which scans it before pushing it to the app's ECR repository, `<project>/<app>`.

## Docs

23. Each fact lives in one place; everywhere else links to it. Write what's true now; mark future work *(planned)*. Keep docs short, as numbered points or tables: each point or cell is at most two short sentences. What an agent reads stays short: 1,000 words for a doc in `docs/`, 2,100 for `AGENTS.md`; the README 1,200 and a guide 2,500. CI's `kickoff` check fails past that, so cut or link rather than add.
24. Root files are uppercase (`README.md`, `AGENTS.md`); everything in `docs/` and `guides/` is lowercase kebab-case.

## Web UI

25. WCAG 2.2 AA: text 4.5:1, controls and focus rings 3:1, targets at least 24×24px, a visible focus ring that sticky parts never hide, a file picker beside every drop zone, and sign-in that allows paste and password managers.
26. Status is a word plus an icon, never colour alone. Under `prefers-reduced-motion`, motion becomes a fade or nothing, and nothing is shown only through animation.
27. Styles use `design-system.md`'s tokens as CSS variables, never raw values. Fonts and images are served with the app, never from a third-party CDN; images have explicit dimensions and alt text (empty when decorative).
28. Every screen has a loading state in its own layout, an empty state that says what to do, and an error state with a retry.
29. AI output is labelled: show what the agent decided, its reasons and sources, and how to ask for a person to review it.
