#!/usr/bin/env bash
# Lists a PR's failed and running checks, security summary, open review threads and code scanning alerts,
# or answers one thread and resolves it (AGENTS.md rule 16).
# Usage: bash scripts/pr-findings.sh <pr>    |    bash scripts/pr-findings.sh resolve <thread-id> "<reply>"
set -euo pipefail

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

if [ "${1:-}" = resolve ]; then
  thread=${2:?thread id}
  reply=${3:?reply}
  gh api graphql -f query='mutation($t:ID!,$b:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){comment{url}}}' \
    -f t="$thread" -f b="$reply" --jq '.data.addPullRequestReviewThreadReply.comment.url'
  gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' \
    -f t="$thread" --jq '"resolved: \(.data.resolveReviewThread.thread.isResolved)"'
  exit 0
fi

pr=${1:?Usage: bash scripts/pr-findings.sh <pr>}
echo "Checks on #$pr that failed or haven't finished (name, result, link):"
# gh exits non-zero while a check is failing or running; the list is what matters here.
gh pr checks "$pr" --json name,bucket,link \
  --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "- \(.name) \(.bucket) \(.link)"' || true
echo
echo "Security summary on #$pr:"
gh api "repos/$repo/issues/$pr/comments" --paginate \
  --jq '.[] | select(.body | startswith("<!-- security-report -->")) | .body | ltrimstr("<!-- security-report -->") | ltrimstr("\n")'
echo
echo "Open review threads on #$pr (id, place, author, comment):"
gh api graphql -f query='query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100){nodes{id isResolved path line comments(first:1){nodes{author{login} body}}}}}}}' \
  -f o="${repo%/*}" -f n="${repo#*/}" -F p="$pr" \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not) | "- \(.id) \(.path):\(.line // "-") [\(.comments.nodes[0].author.login)] \(.comments.nodes[0].body | gsub("<[^>]+>"; "") | gsub("[[:space:]]+"; " ") | .[0:500])"'
echo
echo "Open code scanning alerts on #$pr (number, severity, place, rule):"
gh api "repos/$repo/code-scanning/alerts?ref=refs/pull/$pr/merge&state=open&per_page=100" \
  --jq '.[] | "- #\(.number) \(.rule.security_severity_level // .rule.severity) \(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line) \(.rule.description)"' \
  2> /dev/null || echo "- none, or code scanning isn't on"
