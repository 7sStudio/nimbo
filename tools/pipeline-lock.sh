#!/usr/bin/env bash
# One full pipeline at a time on this machine: overlapping runs from several worktrees pushed the
# load high enough to make the timing tests flake. Sourced by tools/ci.sh;
# `pipeline_lock` waits for the lock under the git common dir, takes it and frees it on exit. PIPELINE_LOCK=0 skips it.

pipeline_lock() {
  [ "${PIPELINE_LOCK:-1}" = "0" ] && return 0
  local dir holder waited=0
  dir="$(git rev-parse --path-format=absolute --git-common-dir)/jsnb-pipeline.lock"
  until mkdir "$dir" 2>/dev/null; do
    holder=$(cat "$dir/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      echo "pipeline lock: freeing the lock of pid $holder, which has ended"
      rm -rf "$dir"
      continue
    fi
    [ "$waited" -eq 0 ] && echo "pipeline lock: a pipeline is running in $(cat "$dir/where" 2>/dev/null || echo '?'); waiting for it"
    sleep 5
    waited=$((waited + 5))
  done
  echo "$$" >"$dir/pid"
  pwd >"$dir/where"
  PIPELINE_LOCK_DIR=$dir
  trap 'rm -rf "$PIPELINE_LOCK_DIR"' EXIT
  [ "$waited" -eq 0 ] || echo "pipeline lock: taken after ${waited} s"
}
