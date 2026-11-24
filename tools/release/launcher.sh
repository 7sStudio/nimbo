#!/bin/sh
# The installed command: runs this version's own Node on its CLI. It follows the links that lead to it (the launcher in
# ~/.local/bin, Homebrew's bin), so it works from wherever it is linked.
self=$0
while [ -h "$self" ]; do
  link=$(readlink "$self")
  case $link in
    /*) self=$link ;;
    *) self=$(dirname "$self")/$link ;;
  esac
done
root=$(cd "$(dirname "$self")/.." && pwd -P) || exit 1
exec "$root/node/bin/node" "$root/app/dist/main.js" "$@"
