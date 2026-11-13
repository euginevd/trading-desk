#!/usr/bin/env bash
# Hardens the repo: Actions settings, squash-only merges, GitHub's free security features, a main ruleset, and
# the apply environments, which deploy from main only.
# Safe to rerun: each run applies this file's settings again. The ruleset and the environments need a public
# repo or a paid plan.
# Usage: bash scripts/protect-main.sh [production]
# production: a PR needs a second reviewer, so GitHub, not a rule, stops the agent merging alone: one approval
# that isn't the author's, given after the last push, with every review thread resolved. Without it, the
# prototype settings: no review needed (AGENTS.md rule 12).
set -uo pipefail

case "${1:-prototype}" in
  production) reviews=1; reviewed=true; targets=(dev prod) ;;
  prototype) reviews=0; reviewed=false; targets=(dev) ;;
  *) echo "Usage: bash scripts/protect-main.sh [production]"; exit 1 ;;
esac

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 1
public=$(gh repo view --json visibility --jq '.visibility == "PUBLIC"')

# Runs one gh api call quietly; a failure shows its error and is counted.
failed=0
# What only a person can do, printed last: one line each, what to do and the page to do it on.
by_hand=()
api() { gh api "$@" >/dev/null || failed=$((failed + 1)); }

# Squash merges only, and merged branches are deleted.
api -X PATCH "repos/$repo" -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -F delete_branch_on_merge=true
# Workflow tokens are read-only unless a workflow asks for more, and can't approve PRs.
api -X PUT "repos/$repo/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
# Only GitHub's actions and the two the deploy uses, each pinned to a full commit SHA.
api -X PUT "repos/$repo/actions/permissions" -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
api -X PUT "repos/$repo/actions/permissions/selected-actions" -F github_owned_allowed=true -F verified_allowed=false -f 'patterns_allowed[]=hashicorp/setup-terraform@*' -f 'patterns_allowed[]=aws-actions/configure-aws-credentials@*'
# Dependabot alerts and security-update PRs.
api -X PUT "repos/$repo/vulnerability-alerts"
api -X PUT "repos/$repo/automated-security-fixes"

if [ "$public" = true ]; then
  # Free on public repos: secret scanning with push protection, private reporting (SECURITY.md) and CodeQL.
  api -X PATCH "repos/$repo" --input - <<'JSON'
{"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}}
JSON
  api -X PUT "repos/$repo/private-vulnerability-reporting"
  # CodeQL runs from .github/workflows/codeql.yml; GitHub rejects its results while default setup is on.
  api -X PATCH "repos/$repo/code-scanning/default-setup" -f state=not-configured
  # Anyone can open a PR on a public repo: their workflow runs wait for your approval.
  api -X PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors
  # No API for the rest of the page, so the script can only point at it.
  by_hand+=("Turn on everything (the AI scans and Agentic autofix use AI credits): https://github.com/$repo/settings/security_analysis")
fi

# Updates the ruleset in place when it exists, so a change here reaches repos made earlier.
id=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id' 2>/dev/null)
if [ -n "$id" ]; then
  target=(-X PUT "repos/$repo/rulesets/$id")
else
  target=(-X POST "repos/$repo/rulesets")
fi

gh api "${target[@]}" --input - >/dev/null <<JSON || { echo "Could not set the ruleset; a private repo needs a paid GitHub plan."; failed=$((failed + 1)); }
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "python" }, { "context": "web" }, { "context": "kickoff" },
          { "context": "workflows" }, { "context": "secrets" }, { "context": "packages-and-iac" },
          { "context": "terraform" }, { "context": "code" }, { "context": "plan-result" }
        ]
      }
    },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": $reviews,
        "dismiss_stale_reviews_on_push": $reviewed,
        "require_code_owner_review": false,
        "require_last_push_approval": $reviewed,
        "required_review_thread_resolution": $reviewed,
        "allowed_merge_methods": ["squash"]
      }
    }
  ]
}
JSON

# The deploy role trusts whatever runs in an apply environment, so each one takes main only: without that, a
# PR that edits a workflow could deploy. A new environment is made that way; one that exists is checked and
# left alone, so its reviewers and variables stay as you set them.
for target in "${targets[@]}"; do
  env="aws-$target-apply"
  if gh api "repos/$repo/environments/$env" >/dev/null 2>&1; then
    custom=$(gh api "repos/$repo/environments/$env" --jq '.deployment_branch_policy.custom_branch_policies // false')
    branches=$(gh api "repos/$repo/environments/$env/deployment-branch-policies" --jq '[.branch_policies[].name] | join(",")' 2>/dev/null)
    if [ "$custom" != true ] || [ "$branches" != main ]; then
      echo "$env deploys from more than main."
      by_hand+=("Open $env and set Deployment branches to main only: https://github.com/$repo/settings/environments")
      failed=$((failed + 1))
    fi
  else
    gh api -X PUT "repos/$repo/environments/$env" --input - >/dev/null <<'JSON' || { echo "Could not create $env; a private repo needs a paid GitHub plan."; failed=$((failed + 1)); continue; }
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
    api -X POST "repos/$repo/environments/$env/deployment-branch-policies" -f name=main -f type=branch
  fi
done

if [ "$reviews" -gt 0 ]; then
  by_hand+=("Give the second reviewer write access: https://github.com/$repo/settings/access")
  by_hand+=("On each apply environment, add them as a required reviewer and tick Prevent self-review: https://github.com/$repo/settings/environments")
fi

if [ "$failed" -gt 0 ]; then
  echo "$failed settings failed on $repo; see the errors above."
else
  echo "Settings and ruleset 'main' applied to $repo: $reviews approval(s) needed to merge; ${targets[*]/#/aws-} apply from main only."
fi
if [ "${#by_hand[@]}" -gt 0 ]; then
  echo
  echo "Left to do by hand:"
  for i in "${!by_hand[@]}"; do echo "  $((i + 1)). ${by_hand[$i]}"; done
fi
[ "$failed" -eq 0 ]
