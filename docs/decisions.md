# Decisions

The decisions in force, newest last. A superseded decision keeps its number as a one-line pointer (*Superseded by N:* what it was), so citations still work; git keeps the full text.

Each is one or two lines: **The decision** (date). Why: the reason. Instead of: what it replaced or ruled out.

1. **Profile `prototype`; euginevd owns the code and accepts every trade-off in [guides/03-security-trade-offs.md](../guides/03-security-trade-offs.md)** (2026-11-13). `dev` only, 50% coverage, and nothing places a real order until a new decision says so. Why: one owner, no customers, and the MVP only reads. Instead of: `production`, which needs a second reviewer and a second AWS account.
2. **The agent never reads an exchange key, and the `.env` deny rules stay in `.claude/settings.json`** (2026-11-13). The owner puts each key in Secrets Manager; the agent troubleshoots from logs. Why: a prototype's secrets are meant to be made up, and these guard real money. Instead of: AGENTS.md rule 13's default, which drops the deny rules, and rule 26's leave to read `.env`.
3. **Deploy target: Lambda, HTTP API, DynamoDB, Secrets Manager, Cognito, S3 and CloudFront in `ap-southeast-2`** (2026-11-13). Why: near nothing when idle, and the template's pipeline already deploys it. The limits, from the services' documented behaviour and still to be proved by each walking skeleton (AGENTS.md rule 17):
   - Lambda has no fixed outbound address, so Binance's IP allowlist needs a VPC and a NAT with an Elastic IP, about $45 a month. The MVP's read-only key goes without; the fixed address is built before any key can trade (spec 10).
   - Lambda runs 15 minutes at most and holds no socket open between runs, so prices are polled and bots run on a schedule, a minute apart at the closest.
   - HTTP API cuts a request off at 30 seconds, so a slow exchange read is served from the last snapshot.
   - DynamoDB has no joins and a 400 KB item limit: one table, keyed by kind and time.
   - Secrets Manager charges $0.40 a secret a month and can't hide a secret from a role allowed to read it: only the `api` role may.
   - Cognito: sign-up off, one user made by the owner, multi-factor sign-in required.
   - CloudFront serves the web app from a private bucket; its certificate must be in `us-east-1` once there's a domain.

   Instead of: a container that's always on (a fixed address and live sockets, but about $30 a month before it does anything), revisited at the bots stage.
4. **One web app, `desk`, with a dashboard that links to each product's screens** (2026-11-13). Why: one user and one sign-in. Instead of: an app per audience, as in travel-claims.
5. **The repo is public, as every personal or portfolio project is, so nothing secret goes in code, Terraform or its state** (2026-11-13). Why: it's built in the open (AGENTS.md rule 30), and anyone signed in to GitHub can download `main`'s saved plan for a day (trade-offs 5). Account IDs and resource names are accepted as visible. Instead of: a private repo, kept for work projects.
6. **Personal use for three months, then a decision on commercialising** (2026-11-13). Why: prove it on the owner's own account first; trading for others brings licensing (spec, Business). Instead of: building for other users from the start.
7. **Local first, then AWS** (2026-11-13). Every feature is built and tested locally; the owner bootstraps AWS once happy with it, and walking skeletons start then (AGENTS.md rule 17). Why: prove it on a laptop before it costs AWS money. Instead of: deploying each new service to `dev` from its first phase.
