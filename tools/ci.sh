#!/usr/bin/env bash
# The pull-request pipeline of 09-testing §9 as named stages, each calling the root script that runs it alone.
# `STAGES=lint,typecheck pnpm ci` runs a subset. Stages that do not depend on each other run at the same time:
# lint, typecheck and the unit stage together; then the build; then the integration stage alone,
# since it holds the timing budgets that a loaded machine would flake; then browser and contract together. Each stage
# writes its own log, printed whole once its group ends, and the summary table comes last.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=tools/pipeline-lock.sh
source tools/pipeline-lock.sh
pipeline_lock

all="install lint typecheck test build integration browser contract acceptance"
stages=" ${STAGES:-$all} "
stages="${stages//,/ }"
logs=$(mktemp -d)

declare -a names statuses seconds
failed=0

commands_of() {
  case "$1" in
    install)     echo "pnpm install --frozen-lockfile" ;;
    lint)        printf '%s\n' "pnpm lint" "pnpm format:check" "pnpm knip" "pnpm depcruise" ;;
    typecheck)   echo "pnpm typecheck" ;;
    test)        echo "pnpm test:coverage" ;;
    build)       echo "pnpm build" ;;
    integration) echo "pnpm test:integration" ;;
    browser)     echo "pnpm test:browser" ;;
    contract)    printf '%s\n' "pnpm test:contract" "pnpm size" "pnpm test:security" ;;
    acceptance)  echo "pnpm test:acceptance" ;;
    *) return 1 ;;
  esac
}

label_of() {
  case "$1" in
    test) echo "unit+component" ;;
    contract) echo "contract+size+security" ;;
    *) echo "$1" ;;
  esac
}

# Runs one stage's commands in order into its log; the exit status and the seconds go to files beside it.
stage_job() {
  local name="$1" start=$SECONDS status=0
  while IFS= read -r cmd; do
    printf '$ %s\n' "$cmd"
    bash -c "$cmd" || { status=1; break; }
  done < <(commands_of "$name")
  echo "$status" >"$logs/$name.status"
  echo "$((SECONDS - start))" >"$logs/$name.seconds"
}

# Starts every selected stage of a group at once, waits for all, then prints their logs in order.
run_group() {
  local name selected=()
  for name in "$@"; do [[ "$stages" == *" $name "* ]] && selected+=("$name"); done
  [[ ${#selected[@]} -eq 0 ]] && return 0
  for name in "${selected[@]}"; do stage_job "$name" >"$logs/$name.log" 2>&1 & done
  wait
  for name in "${selected[@]}"; do
    printf '\n===== %s =====\n' "$(label_of "$name")"
    cat "$logs/$name.log"
    local code took
    code=$(cat "$logs/$name.status"); took=$(cat "$logs/$name.seconds")
    names+=("$(label_of "$name")"); seconds+=("$took")
    if [[ "$code" == "0" ]]; then statuses+=("ok"); else statuses+=("FAILED"); failed=1; fi
  done
}

for stage in $stages; do commands_of "$stage" >/dev/null || { echo "unknown stage: $stage (known: $all)"; exit 2; }; done

start=$SECONDS
run_group install
run_group lint typecheck test
run_group build
run_group integration
run_group browser contract
run_group acceptance

printf '\n%-24s %-8s %s\n' stage status seconds
for i in "${!names[@]}"; do
  printf '%-24s %-8s %s\n' "${names[$i]}" "${statuses[$i]}" "${seconds[$i]}"
done
printf '%-24s %-8s %s\n' "wall clock" "" "$((SECONDS - start))"
rm -rf "$logs"
exit $failed
