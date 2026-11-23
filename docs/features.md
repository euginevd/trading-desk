# Features

The agreed features, by app and audience; the agent adds a row when you approve one and updates its status with the work. New requirements start in [TODO.md](../TODO.md), and so do known gaps. Each row here is what the feature does; the rules every feature keeps are in [spec.md](spec.md). How to run it: the README. Numbered across the file so reviews can cite them (features 2). One row per feature, and one PR per row: the one that first built it.

| App | For | Link |
|---|---|---|
| [`desk`](#desk) | The owner | http://127.0.0.1:5180 in Docker (`DESK_PORT`), 5173 with `npm run dev` |
| [`api`](#api) | The `desk` app | Behind the desk at `/api` in Docker; http://127.0.0.1:8000 with `uv run` |

## `desk`

Every page follows [design-system.md](design-system.md) 18 to 22. Features 1 to 52: [features/01-52.md](features/01-52.md); 54 to 72: [features/53-72.md](features/53-72.md); 73 to 94: [features/73-94.md](features/73-94.md); 95 to 99: [features/95-99.md](features/95-99.md); 100 to 106: [features/100-106.md](features/100-106.md); 107 to 117: [features/107-117.md](features/107-117.md); 118 to 127: [features/118-127.md](features/118-127.md); 128 on: [features/128-137.md](features/128-137.md).



## `api`

Features 7 to 25: [features/01-52.md](features/01-52.md); 53: [features/53-72.md](features/53-72.md).

## Behind every app

What no single app owns, such as an agent, a check every request goes through, or a deployment. Every feature so far is in [features/01-52.md](features/01-52.md).

Status: Next, Building, Done or Dropped (with the reason).
