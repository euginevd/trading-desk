# Known mistakes: CI

Moved from [known-mistakes.md](../known-mistakes.md) to keep it short; the numbers stay.

8a. A boolean `workflow_dispatch` input is empty on a push: test the event, as in `github.event_name != 'workflow_dispatch' || inputs.deploy`.
8b. The AWS CLI on GitHub's runners reads `file:///dev/stdin` as empty: pass a request through a private temporary file, then delete it.
8c. The repo allows only listed actions, and an action's own steps count: `anthropics/claude-code-action` needs `oven-sh/setup-bun` listed too, or the run fails at startup. Before adding an action, read its `action.yml` for every `uses:` and hand the owner the allow-list command (the agent can't change it).
8d. Claude's workflows skip on the PR that adds or changes them ("must match the default branch"): test `@claude` and the review after the merge, on an issue or the next PR.
8e. A push by `@claude` runs the review as the `claude` bot, which the action refuses unless `allowed_bots` names it; with a fail-open gate that refusal turned the check green unreviewed. A gate must never pass silently: say on the PR when the review didn't run.
8f. A reply on a review thread fires `pull_request_review` and `pull_request_review_comment` both, and a concurrency group per PR keeps one waiting run, so two `@claude` replies dropped one: trigger on the comment only, grouped per comment.
8g. Quoting Claude's summary (which names `@claude`) called Claude: a comment must start with `@claude` to call it.
