# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`api`](#api) | *(to fill in)* who uses it | *(to fill in)* its local or deployed address |

## `api`

One section per app, in the table's order, each listing what it offers its audience.

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | Health check, `GET /health` (spec 7) | Done | Starter |
| 2 | *(to fill in)* | Next | |

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment.

| # | Feature | Status | PR |
|---|---|---|---|
| 3 | Pipeline: app checks, security scans, and a Terraform plan and apply through the `aws` workflow: a merge to `main` applies to `dev` (production: once a second reviewer approves), `prod` is a manual run | Done | Starter |
| 4 | *(to fill in)* | Next | |

Status: Next, Building, Done or Dropped (with the reason).
