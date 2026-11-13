#!/usr/bin/env bash
# Scans each pushed commit's files and unpushed diffs, so a secret added then removed is still caught:
# gitleaks for secrets, Trivy for packages, IaC and secrets. Exits 1 to block the push.
# SCAN_SEVERITY sets Trivy's blocking levels (default HIGH,CRITICAL).
set -uo pipefail

for tool in gitleaks trivy; do
  command -v "$tool" >/dev/null || { echo "Pre-push scan: $tool not found, run bash scripts/setup.sh"; exit 1; }
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# git sends "<local ref> <local sha> <remote ref> <remote sha>" per pushed ref; none when run by hand.
shas=()
if [ ! -t 0 ]; then
  while read -r _ sha _ _; do
    [ -n "$sha" ] && [ "$sha" != "0000000000000000000000000000000000000000" ] && shas+=("$sha")
  done
fi
[ ${#shas[@]} -eq 0 ] && shas=(HEAD)

for i in "${!shas[@]}"; do
  dir="$tmp/scan/$i"
  mkdir -p "$dir"
  # A commit that can't be extracted in full blocks the push, or the scan would pass on part of it.
  git archive "${shas[$i]}" | tar -x -C "$dir" \
    && git log -p --no-color "${shas[$i]}" --not --remotes > "$dir/unpushed-history.patch" \
    || { echo "Pre-push scan: could not read ${shas[$i]}"; exit 1; }
done

failed=()

gitleaks dir "$tmp/scan" --no-banner --redact --exit-code 1 </dev/null || failed+=(gitleaks)

trivy fs "$tmp/scan" --quiet --scanners vuln,misconfig,secret \
  --severity "${SCAN_SEVERITY:-HIGH,CRITICAL}" --ignore-unfixed --exit-code 1 </dev/null || failed+=(trivy)

if [ ${#failed[@]} -gt 0 ]; then
  echo "Pre-push scan: blocked by ${failed[*]}. Fix the findings above."
  exit 1
fi
echo "Pre-push scan: passed"
