# Spec

A starter: it describes the sample the template ships, a health-check API, and each line marked to fill in says what to write. Kickoff fills it in from your notes. In `production` the user approves every change; a `prototype`'s agent makes them itself and says so ([AGENTS.md](../AGENTS.md) rules 12 and 23). New requirements start in [TODO.md](../TODO.md); once one is approved (a prototype's agent takes them as they come), the agent adds it to [features.md](features.md) and any rule, limit or done-when it needs here. What each feature does is its row in `features.md`, not a line here.

## Business

Who the business is, unnumbered so the spec's numbers stay put. The same for every project for this business: change it only when the business changes, and copy it into the next project's spec.

- Business: *(to fill in)* its name, what it does and where.
- Size: *(to fill in)* staff, the team this is for, and the volume it handles.
- Regulators and laws: *(to fill in)* the ones that apply to its data and decisions, or none.
- Data: *(to fill in)* where customer data must stay.
- Risk appetite: *(to fill in)* what it won't risk, and how changes reach `prod`.
- Systems: *(to fill in)* the systems of record, sign-in and payments this must fit with.
- People: *(to fill in)* who owns the rules the software applies, and who approves new data flows.
- Tone: *(to fill in)* how it speaks to its customers.

## Project

Profile: *(to fill in)* `prototype` or `production`.

1. Name: `starter`
2. Problem: *(to fill in)* what's slow, costly or missing today, and for whom.
3. Goal: *(to fill in)* what's true once this works.
4. Users: *(to fill in)* who uses it, and what each of them does.
5. AWS: *(to fill in)* the accounts, region and environments. The pipeline deploys `dev` on merge and `prod` by hand.

## Stack

Template defaults: GitHub Actions, Terraform on AWS, the pre-push scan and the PR security checks.

6. `api`: Python on Lambda behind an HTTP API, the template's sample. Keep it, build on it or replace it.

## Done when

7. `GET /health` returns `{"status": "ok"}`.
8. *(to fill in)* what done means for the MVP as a whole; each feature's own result is its row in `features.md`.

## Rules

9. `/health` is public and returns nothing from the request.
10. *(to fill in)* the limits that hold whatever else changes: data, money, monthly spend and the security baseline, as an OWASP ASVS level (1 for a prototype, 2 for production).

## Not for now

11. *(to fill in)* what's deliberately left out.
