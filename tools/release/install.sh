#!/bin/sh
# The nimbo installer, for macOS and Linux on arm64 and x64:
#
#   curl -fsSL https://github.com/7sStudio/nimbo/releases/latest/download/install.sh | sh
#   curl -fsSL https://github.com/7sStudio/nimbo/releases/latest/download/install.sh | sh -s -- --version 0.1.0
#
# Installs the release into ${XDG_DATA_HOME:-~/.local/share}/nimbo/versions/<version> and links ~/.local/bin/nimbo
# to it. Running it again installs or repairs. At a terminal it shows what it will do and asks (answers are read
# from /dev/tty, since stdin is the download); without one it takes the defaults. --help lists the options.

# Everything runs from main, called on the last line: a download cut short defines no complete function and runs nothing.
main() {
  set -eu
  name=nimbo
  releases_default="https://github.com/7sStudio/nimbo/releases"
  copyright="Copyright 2026 7sStudio. Apache License 2.0."
  tmp=""
  work=""
  locked=0
  changed=0
  made=""
  current=""
  style

  version=${NIMBO_VERSION:-}
  modify_path=1
  [ "${NIMBO_NO_MODIFY_PATH:-0}" = 0 ] || modify_path=0
  profile=${NIMBO_PROFILE:-}
  mcp=${NIMBO_MCP:-}
  duckdb=${NIMBO_DUCKDB:-}
  yes=0
  [ "${NIMBO_YES:-0}" = 0 ] || yes=1
  allow_root=0
  while [ $# -gt 0 ]; do
    case $1 in
      --version) [ $# -ge 2 ] || fail "--version needs a version, such as 0.1.0." "See --help."; version=$2; shift 2 ;;
      --version=*) version=${1#--version=}; shift ;;
      --no-modify-path) modify_path=0; shift ;;
      --profile) [ $# -ge 2 ] || fail "--profile needs a file, such as ~/.zshrc." "See --help."; profile=$2; shift 2 ;;
      --profile=*) profile=${1#--profile=}; shift ;;
      --mcp) mcp=1; shift ;;
      --no-mcp) mcp=0; shift ;;
      --duckdb) duckdb=1; shift ;;
      --no-duckdb) duckdb=0; shift ;;
      -y | --yes) yes=1; shift ;;
      --allow-root) allow_root=1; shift ;;
      -h | --help) usage; return 0 ;;
      *) fail "Unknown option: $1." "Run with --help to see the options." ;;
    esac
  done
  version=${version#v}
  if [ -n "$version" ] && ! is_version "$version"; then
    fail "\"$version\" is not a version such as 0.1.0." "Pass a release number, or leave --version out for the latest."
  fi

  # A root install would put root-owned files in root's home and leave the user's PATH without it.
  if [ "$(id -u)" = 0 ] && [ "$allow_root" = 0 ]; then
    fail "This installer runs as your own user, not with sudo or as root." "Run it again without sudo (--allow-root installs for root itself)."
  fi
  [ -n "${HOME:-}" ] || fail "HOME is not set." "Set HOME to your home folder and run it again."
  case $HOME in /*) ;; *) fail "HOME is not an absolute path: $HOME." "Set HOME to your home folder and run it again." ;; esac

  target=$(detect_target)
  base=${NIMBO_INSTALL_BASE:-}
  [ -n "$base" ] || base=$releases_default
  base=${base%/}
  if [ -n "$version" ]; then folder="$base/download/v$version"; else folder="$base/latest/download"; fi
  case ${XDG_DATA_HOME:-} in /*) data_home=$XDG_DATA_HOME ;; *) data_home=$HOME/.local/share ;; esac
  case ${XDG_CONFIG_HOME:-} in /*) config_home=$XDG_CONFIG_HOME ;; *) config_home=$HOME/.config ;; esac
  data_shown="$data_home/$name"
  data=$(physical "$data_shown")
  bin_dir=${NIMBO_BIN_DIR:-$HOME/.local/bin}
  case $bin_dir in /*) ;; *) fail "NIMBO_BIN_DIR must be an absolute path, not $bin_dir." "Set it to a full path, such as \$HOME/bin." ;; esac
  launcher="$bin_dir/$name"
  if [ -n "$profile" ]; then
    case $profile in
      "~/"*) profile="$HOME/${profile#"~/"}" ;;
      /*) ;;
      *) fail "--profile must be an absolute path or start with ~/, not $profile." "Pass the full path of your shell's profile file." ;;
    esac
  fi

  ask_ok=0
  if [ "$yes" = 0 ] && [ -t 1 ] && [ -z "${CI:-}" ] && (: </dev/tty) 2>/dev/null; then ask_ok=1; fi

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/$name-install.XXXXXX")
  trap 'cleanup' EXIT
  trap 'interrupted' INT TERM HUP

  header
  check_launcher
  begin "Finding the release"
  read_manifest
  ok "Found $name $release" "$target, $(mb "$size") to download"
  say ""

  dest="$data/versions/$release"
  dest_shown="$data_shown/versions/$release"
  detect_profile
  detect_agents
  old_daemons=$(recent_daemons)
  [ -n "$mcp" ] || if [ -n "$agents" ] && [ "$ask_ok" = 1 ]; then mcp=1; else mcp=0; fi
  [ -n "$duckdb" ] || duckdb=0
  [ -n "$agents" ] || mcp=0

  plan
  if [ "$ask_ok" = 1 ]; then choose_plan; fi

  begin "Taking the install lock"
  take_lock
  sweep_leftovers
  ok_quiet

  if [ -d "$dest" ] && in_use "$release"; then
    note "$name $release is installed and running: kept as it is."
  else
    install_release
  fi
  link_launcher
  path_line
  write_record "$data/install.json" "$launcher" "$profiles" "$created"
  sweep_old
  release_lock

  [ "$mcp" = 0 ] || register_mcp
  [ "$duckdb" = 0 ] || install_duckdb
  finish
}

usage() {
  cat <<EOF
Installs nimbo for this user (macOS and Linux, arm64 and x64).

Usage: curl -fsSL <releases>/latest/download/install.sh | sh -s -- [options]

At a terminal it shows what it will do and asks; without one (CI, a pipe) it takes the defaults
and asks nothing. Each choice has a flag and an environment variable:

  --version <v>      NIMBO_VERSION=<v>         install release <v> instead of the latest
  --no-modify-path   NIMBO_NO_MODIFY_PATH=1    do not add the command's folder to PATH
  --profile <file>   NIMBO_PROFILE=<file>      the shell profile that gets the PATH line
                                               (default: your shell's, such as ~/.zshrc)
  --mcp, --no-mcp    NIMBO_MCP=1 or 0          register the MCP server with the agents found
                                               (default: yes at a terminal when one is found, no otherwise)
  --duckdb, --no-duckdb  NIMBO_DUCKDB=1 or 0   install DuckDB now, for SQL from the CLI and agents
                                               (about 40 MB; default: no)
  -y, --yes          NIMBO_YES=1               take every default without asking
  --allow-root                                 allow running as root

Environment:
  NIMBO_INSTALL_BASE  the releases URL (default $releases_default), a file:// URL or a folder
  NIMBO_BIN_DIR       where the nimbo link goes (default ~/.local/bin); an absolute path
  XDG_DATA_HOME       the data folder's parent (default ~/.local/share)
  NO_COLOR            plain text, no colour
EOF
}

# Colour only on a terminal, without NO_COLOR, and not for TERM=dumb; check marks only in a UTF-8 locale.
style() {
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
    esc=$(printf '\033')
    B="$esc[1m" D="$esc[2m" R="$esc[31m" G="$esc[32m" Y="$esc[33m" C="$esc[36m" N="$esc[0m"
  else
    B="" D="" R="" G="" Y="" C="" N=""
  fi
  E2=""
  if [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then E2=$(printf '\033'); fi
  case ${LC_ALL:-${LC_CTYPE:-${LANG:-}}} in
    *UTF-8* | *utf-8* | *UTF8* | *utf8*) M_OK="✓" M_FAIL="✗" M_WARN="!" M_ARROW="→" M_DOT="•" ;;
    *) M_OK="+" M_FAIL="x" M_WARN="!" M_ARROW="->" M_DOT="*" ;;
  esac
}

say() { printf '%s\n' "$1"; }
# A step line: begin names the step (so a failure says which), ok ends it.
begin() { current=$1; }
ok() {
  printf '  %s %s%s\n' "$G$M_OK$N" "$1" "${2:+  $D$2$N}"
  current=""
}
ok_quiet() { current=""; }
note() { printf '  %s %s\n' "$Y$M_WARN$N" "$1"; }
show_path() {
  case $1 in
    "$HOME") printf '~' ;;
    "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}
mb() { awk -v b="$1" 'BEGIN { m = b / 1000000; if (m < 10) printf "%.1f MB", m; else printf "%d MB", m + 0.5 }'; }

# What failed, then what to do; nothing is left half done (the lock and the scratch folder go with the EXIT trap).
fail() {
  if [ -n "$E2" ]; then r2="$E2[31m" b2="$E2[1m" n2="$E2[0m"; else r2="" b2="" n2=""; fi
  if [ -n "${current:-}" ]; then
    printf '  %s %s\n' "$r2$M_FAIL$n2" "$current" >&2
    printf '    %s\n' "$b2$1$n2" >&2
    [ -z "${2:-}" ] || printf '    %s\n' "$2" >&2
  else
    printf '%s %s\n' "$r2$M_FAIL$n2" "$b2$1$n2" >&2
    [ -z "${2:-}" ] || printf '  %s\n' "$2" >&2
  fi
  exit 1
}

cleanup() {
  [ "$locked" = 0 ] || rm -rf "$data/.lock"
  [ -z "$tmp" ] || rm -rf "$tmp"
  [ -z "$work" ] || rm -rf "$work"
  # Folders this run made while nothing was installed yet, deepest first: then "Nothing was changed" holds.
  if [ "$changed" = 0 ] && [ -n "$made" ]; then
    while IFS= read -r dir; do
      rmdir "$dir" 2>/dev/null || break
    done <<EOF
$made
EOF
  fi
  return 0
}

interrupted() {
  trap - INT TERM HUP
  printf '\n' >&2
  if [ "$changed" = 0 ]; then
    printf '%s Cancelled. Nothing was changed.\n' "$R$M_FAIL$N" >&2
  else
    printf '%s Cancelled. Run the installer again to finish.\n' "$R$M_FAIL$N" >&2
  fi
  cleanup
  trap - EXIT
  exit 130
}

# A release version names a folder: digits and dots, an optional pre-release of letters, digits, dots and hyphens.
is_version() {
  case $1 in
    *..* | *[!0-9A-Za-z.-]* | "") return 1 ;;
  esac
  printf '%s\n' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$'
}

# `path` with its existing part resolved (cd -P): ps shows a process's executable by its physical path.
physical() {
  p=$1 rest=""
  while [ ! -d "$p" ]; do
    rest="/$(basename "$p")$rest"
    p=$(dirname "$p")
  done
  p=$(cd -P "$p" && pwd -P)
  [ "$p" != / ] || p=""
  printf '%s%s' "$p" "$rest"
}

detect_target() {
  os=$(uname -s)
  arch=$(uname -m)
  case $os in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "$os is not supported." "nimbo runs on macOS and Linux." ;;
  esac
  case $arch in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "The $arch processor is not supported." "nimbo runs on arm64 and x64." ;;
  esac
  # A shell under Rosetta reports x86_64 on an Apple silicon Mac: the native build is the right one.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  if [ "$os" = linux ] && (ldd --version 2>&1 || true) | grep -qi musl; then
    fail "musl-based Linux (Alpine) is not supported." "The bundled Node needs glibc."
  fi
  printf '%s-%s' "$os" "$arch"
}

header() {
  say ""
  say "$B$name installer$N  ${D}for $target$N"
  say ""
}

# The link may be replaced only when it is ours (into this data folder's versions) or there is none.
check_launcher() {
  [ -e "$launcher" ] || [ -h "$launcher" ] || return 0
  if [ ! -h "$launcher" ]; then
    fail "$(show_path "$launcher") exists and is not the installer's link." "Remove it, or set NIMBO_BIN_DIR to install the link elsewhere."
  fi
  points=$(readlink "$launcher")
  case $points in
    "$data/versions/"* | "$data_shown/versions/"*) return 0 ;;
  esac
  case $(physical "$(dirname "$points")") in
    "$data/versions/"*) return 0 ;;
  esac
  fail "$(show_path "$launcher") is a link to $points, not to this install." "Remove it, or set NIMBO_BIN_DIR to install the link elsewhere."
}

# fetch <url> <file> <progress 0|1>: 0 when fetched, 2 when there is nothing at the URL, 1 otherwise ($why says why).
fetch() {
  why=""
  case $1 in
    http://* | https://*)
      if command -v curl >/dev/null 2>&1; then
        fetch_curl "$@"
      elif command -v wget >/dev/null 2>&1; then
        rc=0
        wget -q -T 30 -O "$2" "$1" || rc=$?
        case $rc in
          0) return 0 ;;
          8) why="the server answered with an error"; return 2 ;;
          *) why="wget failed (exit $rc)"; return 1 ;;
        esac
      else
        why="neither curl nor wget is installed"
        return 1
      fi
      ;;
    file://* | /*)
      src=${1#file://}
      [ -f "$src" ] || { why="no such file"; return 2; }
      cp "$src" "$2" 2>/dev/null || { why="the file could not be read"; return 1; }
      ;;
    *) why="NIMBO_INSTALL_BASE must be an http(s) URL, a file:// URL or an absolute folder"; return 1 ;;
  esac
}

fetch_curl() {
  rc=0
  # The server may stay silent 30 s at most (under 1 byte a second for 30 s ends it).
  if [ "$3" = 1 ] && [ -t 2 ] && [ "${TERM:-}" != dumb ]; then
    code=$(curl -L --progress-bar --retry 2 --connect-timeout 20 --speed-limit 1 --speed-time 30 -w '%{http_code}' -o "$2" "$1") || rc=$?
    printf '\033[1A\r\033[K' >&2
  else
    code=$(curl -sL --retry 2 --connect-timeout 20 --speed-limit 1 --speed-time 30 -w '%{http_code}' -o "$2" "$1") || rc=$?
  fi
  case $rc in
    0) ;;
    6) why="the server's name could not be found"; return 1 ;;
    7) why="the server refused the connection"; return 1 ;;
    23) why="the download could not be written (is the disk full?)"; return 1 ;;
    28) why="the server stopped answering"; return 1 ;;
    35 | 51 | 60) why="the secure connection failed"; return 1 ;;
    52 | 56) why="the connection was cut"; return 1 ;;
    *) why="curl failed (exit $rc)"; return 1 ;;
  esac
  case $code in
    2??) return 0 ;;
    404) why="not found"; return 2 ;;
    *) why="the server answered $code"; return 1 ;;
  esac
}

read_manifest() {
  rc=0
  fetch "$folder/manifest.json" "$tmp/manifest.json" 0 || rc=$?
  if [ "$rc" = 2 ]; then
    if [ -n "$version" ]; then
      fail "$name $version does not exist." "See the releases at $base, or leave --version out for the latest."
    fi
    fail "No $name release was found at $base." "Check NIMBO_INSTALL_BASE, or try again later."
  fi
  [ "$rc" = 0 ] || fail "Could not download the release's manifest: $why." "Check your network (or NIMBO_INSTALL_BASE), then run the installer again."
  flat=$(tr -d ' \n\r\t' < "$tmp/manifest.json")
  release=$(printf '%s' "$flat" | sed -n 's/^{"name":"[^"]*","version":"\([^"]*\)".*/\1/p')
  # The version names folders that are later replaced or removed: nothing but a strict version is taken.
  is_version "$release" || fail "The release's manifest names an invalid version: \"$release\"." "The release looks wrong; report it."
  if [ -n "$version" ] && [ "$release" != "$version" ]; then
    fail "The release folder for $version holds $name $release." "The release looks wrong; report it."
  fi
  entry=$(printf '%s' "$flat" | sed -n "s/.*\"$target\":{\([^}]*\)}.*/\1/p")
  file=$(printf '%s' "$entry" | sed -n 's/.*"file":"\([^"]*\)".*/\1/p')
  size=$(printf '%s' "$entry" | sed -n 's/.*"size":\([0-9][0-9]*\).*/\1/p')
  unpacked=$(printf '%s' "$entry" | sed -n 's/.*"unpacked":\([0-9][0-9]*\).*/\1/p')
  sum=$(printf '%s' "$entry" | sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p')
  [ -n "$file" ] && [ -n "$size" ] && [ ${#sum} -eq 64 ] || fail "$name $release has no build for $target." "Pick another release with --version."
  [ "$file" = "$name-$release-$target.tar.gz" ] || fail "The manifest names an unexpected file: $file." "The release looks wrong; report it."
}

detect_profile() {
  profiles=$(recorded_profiles "$data/install.json")
  created=$(recorded_created "$data/install.json")
  on_path=0
  case ":$PATH:" in *":$bin_dir:"* | *":$(physical "$bin_dir"):"*) on_path=1 ;; esac
  [ -n "$profile" ] || profile=$(profile_file)
}

# The agents `nimbo mcp install --agent` knows, as ids and as names.
detect_agents() {
  agents="" agent_names=""
  if command -v claude >/dev/null 2>&1; then agents="claude-code"; agent_names="Claude Code"; fi
  if command -v code >/dev/null 2>&1; then agents="${agents:+$agents,}vscode"; agent_names="${agent_names:+$agent_names, }VS Code"; fi
  if [ -d "$HOME/.cursor" ]; then agents="${agents:+$agents,}cursor"; agent_names="${agent_names:+$agent_names, }Cursor"; fi
  if [ "$(uname -s)" = Darwin ]; then desktop="$HOME/Library/Application Support/Claude"; else desktop="$config_home/Claude"; fi
  if [ -d "$desktop" ]; then agents="${agents:+$agents,}claude-desktop"; agent_names="${agent_names:+$agent_names, }Claude Desktop"; fi
}

yesno() { if [ "$1" = 1 ]; then printf 'yes'; else printf 'no'; fi; }

plan() {
  say "${B}This will:$N"
  disk=""
  [ -z "$unpacked" ] || disk=", $(mb "$unpacked") on disk"
  say "  $M_DOT install $B$name $release$N  ${D}($(mb "$size") download$disk)$N"
  say "    ${D}in $(show_path "$dest_shown")$N"
  say "  $M_DOT link the command $C$(show_path "$launcher")$N"
  if [ "$on_path" = 1 ]; then
    say "  $M_DOT PATH: $(show_path "$bin_dir") is on it already"
  elif [ "$modify_path" = 1 ]; then
    say "  $M_DOT add $(show_path "$bin_dir") to PATH in $C$(show_path "$profile")$N"
  else
    say "  $M_DOT leave PATH as it is"
  fi
  if [ -n "$agents" ]; then
    if [ "$mcp" = 1 ]; then say "  $M_DOT register the MCP server with $agent_names"; else say "  $M_DOT skip the MCP server  ${D}(found: $agent_names)$N"; fi
  fi
  if [ "$duckdb" = 1 ]; then say "  $M_DOT install DuckDB for SQL  ${D}(about 40 MB)$N"; fi
  if [ -n "$old_daemons" ]; then
    count=$(printf '%s\n' "$old_daemons" | grep -c .)
    if [ "$count" = 1 ]; then they="1 daemon runs"; else they="$count daemons run"; fi
    say "  $Y$M_WARN$N $they an older version until restarted"
  fi
  say ""
}

# Reads one answer from the terminal (stdin is the download under curl | sh); Ctrl-D cancels.
ask() {
  printf '%s %s ' "$C?$N" "$B$1$N" >/dev/tty
  answer=""
  IFS= read -r answer </dev/tty || { printf '\n'; current=""; fail "Cancelled. Nothing was changed."; }
}

confirm() { # question default(1/0) -> sets $reply 1/0
  while :; do
    if [ "$2" = 1 ]; then ask "$1 ${D}(Y/n)$N"; else ask "$1 ${D}(y/N)$N"; fi
    case $answer in
      "") reply=$2; return ;;
      y | Y | yes | Yes | YES) reply=1; return ;;
      n | N | no | No | NO) reply=0; return ;;
      *) say "  ${D}Type y or n.$N" ;;
    esac
  done
}

pick() { # question count default -> $reply 1..count; the options are printed before
  while :; do
    ask "$1 ${D}(Enter for $3)$N"
    case $answer in
      "") reply=$3; return ;;
      *[!0-9]*) ;;
      *) if [ "$answer" -ge 1 ] && [ "$answer" -le "$2" ]; then reply=$answer; return; fi ;;
    esac
    say "  ${D}Type a number from 1 to $2.$N"
  done
}

choose_plan() {
  say "  ${C}1)$N Proceed  ${D}(default)$N"
  say "  ${C}2)$N Customise"
  say "  ${C}3)$N Cancel"
  pick "Install?" 3 1
  case $reply in
    3) say "Cancelled. Nothing was changed."; exit 0 ;;
    2) customise ;;
  esac
}

customise() {
  say ""
  if [ "$on_path" = 0 ]; then
    confirm "Add $(show_path "$bin_dir") to PATH?" "$modify_path"
    modify_path=$reply
    [ "$modify_path" = 0 ] || choose_profile
  fi
  if [ -n "$agents" ]; then
    confirm "Register the MCP server with $agent_names?" "$mcp"
    mcp=$reply
  fi
  confirm "Install DuckDB for SQL now (about 40 MB)?" "$duckdb"
  duckdb=$reply
  say ""
  plan
  confirm "Install with these choices?" 1
  [ "$reply" = 1 ] || { say "Cancelled. Nothing was changed."; exit 0; }
}

choose_profile() {
  detected=$(profile_file)
  list=$(printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$detected" "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$config_home/fish/config.fish" | awk '!seen[$0]++')
  i=0
  while IFS= read -r candidate; do
    i=$((i + 1))
    hint=""
    [ "$candidate" != "$detected" ] || hint="  ${D}(your shell's)$N"
    say "  $C$i)$N $(show_path "$candidate")$hint"
  done <<EOF
$list
EOF
  pick "Which profile file?" "$i" 1
  profile=$(printf '%s\n' "$list" | sed -n "${reply}p")
}

# Whether a process runs this version's own Node (a daemon, its kernels, an agent's MCP server): such a version is
# never replaced or removed under it. A process that only names a file in the folder does not count; when the
# processes cannot be listed at all, every version counts as in use. Sets use_pids (the pids, or "?" when they cannot
# be listed) and use_mcp (1 when one of them is an agent's MCP server).
in_use() {
  exe_shown="$data_shown/versions/$1/node/bin/node"
  exe="$data/versions/$1/node/bin/node"
  use_pids="" use_mcp=0
  if procs=$(ps -axww -o pid=,args= 2>/dev/null); then
    use_pids=$(printf '%s\n' "$procs" | A="$exe" B="$exe_shown" awk '
      BEGIN { a = ENVIRON["A"]; b = ENVIRON["B"] }
      { sub(/^ +/, ""); pid = $1; sub(/^[0-9]+ +/, "") }
      $0 == a || $0 == b || index($0, a " ") == 1 || index($0, b " ") == 1 { printf "%s ", pid }')
    # Started through another spelling of the path (an alias link to the data folder): the executable's real path.
    [ -n "$use_pids" ] || use_pids=$(real_exe_pids "$exe")
    use_pids=${use_pids% }
    [ -n "$use_pids" ] || return 1
    if printf '%s\n' "$procs" | P=" $use_pids " awk '
      { sub(/^ +/, "") } index(ENVIRON["P"], " " $1 " ") && ($0 ~ / mcp( |$)/ || $0 ~ /\/@jsnb\/mcp\//) { found = 1 }
      END { exit !found }'; then use_mcp=1; fi
    return 0
  fi
  if [ -d /proc/self ]; then
    use_pids=$(real_exe_pids "$exe")
    use_pids=${use_pids% }
    [ -n "$use_pids" ]
    return
  fi
  use_pids="?"
  return 0
}

# The pids whose executable is the file $1 (a physical path), followed through links: /proc on Linux, lsof on macOS.
real_exe_pids() {
  if [ -d /proc/self ]; then
    ls -l /proc/[0-9]*/exe 2>/dev/null | E=" -> $1" awk '
      { at = index($0, " /proc/"); n = index($0, ENVIRON["E"]) }
      at && n && substr($0, n) == ENVIRON["E"] { p = substr($0, at + 7); sub(/\/.*/, "", p); printf "%s ", p }'
  elif command -v lsof >/dev/null 2>&1 || [ -x /usr/sbin/lsof ]; then
    PATH="$PATH:/usr/sbin" lsof -nP -a -c node -d txt -Fpn 2>/dev/null | E="$1" awk '
      /^p/ { pid = substr($0, 2) } /^n/ && substr($0, 2) == ENVIRON["E"] { printf "%s ", pid }'
  fi
  return 0
}

# The daemons of recent workspaces still running, as "version<TAB>folder" lines.
recent_daemons() {
  recent="$config_home/nimbo/recent.json"
  # a version from before the rename still keeps it in the old folder
  [ -f "$recent" ] || recent="$config_home/jsnb/recent.json"
  [ -f "$recent" ] || return 0
  tr ',{}[' '\n\n\n\n' < "$recent" | sed -n 's/^ *"path": *"\(.*\)" *$/\1/p' | while IFS= read -r ws; do
    server="$ws/.jsnb/server.json"
    [ -f "$server" ] || continue
    sflat=$(tr -d '\n\r\t' < "$server" 2>/dev/null) || continue
    pid=$(printf '%s' "$sflat" | sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p')
    ver=$(printf '%s' "$sflat" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || continue
    printf '%s\t%s\n' "$ver" "$ws"
  done
}

# The data folder's lock, shared with nimbo upgrade, uninstall and sql install (the CLI's install/lock.ts): one mkdir,
# with the pid, its start time (so a reused pid is told apart) and the command inside. A stale lock is taken over
# under .lock.takeover, judged again there and renamed aside before it is removed.
take_lock() {
  [ -d "$data" ] || note_made "$data"
  mkdir -p "$data"
  lock="$data/.lock"
  waited=0 unwritten=0
  while ! mkdir "$lock" 2>/dev/null; do
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -z "$holder" ] && [ "$unwritten" -lt 2 ]; then unwritten=$((unwritten + 1)); sleep 1; continue; fi
    if lock_live "$lock"; then
      if [ "$waited" -ge 5 ]; then
        by=$(cat "$lock/command" 2>/dev/null || true)
        fail "Another $name install or upgrade is running (process $holder${by:+: $by})." "Wait for it to finish, then run the installer again. If none is running, remove the lock: rm -r $(quoted "$lock")"
      fi
      waited=$((waited + 1))
      sleep 1
      continue
    fi
    take_over "$lock"
    unwritten=0
  done
  locked=1
  printf '%s\n' "$$" > "$lock/pid"
  printf '%s\n' "$(started_of $$)" > "$lock/started"
  printf '%s\n' "the $name installer" > "$lock/command"
}

# A process's start time as `ps -o lstart=` prints it, or its start in clock ticks where there is no ps.
started_of() {
  s=$(LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//') || s=""
  if [ -z "$s" ] && [ -r "/proc/$1/stat" ]; then s=$(sed 's/.*) //' "/proc/$1/stat" | awk '{ print "stat:" $20 }'); fi
  printf '%s' "$s"
}

# Whether the process a lock names runs: alive, and the same process when its start time was recorded.
lock_live() {
  pid=$(cat "$1/pid" 2>/dev/null || true)
  since=$(cat "$1/started" 2>/dev/null || true)
  case $pid in "" | *[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  [ -n "$since" ] || return 0
  now=$(started_of "$pid")
  [ -z "$now" ] || [ "$now" = "$since" ]
}

take_over() {
  if mkdir "$1.takeover" 2>/dev/null; then
    guard_tries=0
    if ! lock_live "$1"; then
      rm -rf "$1.stale-$$"
      if mv "$1" "$1.stale-$$" 2>/dev/null; then rm -rf "$1.stale-$$"; fi
    fi
    rm -rf "$1.takeover"
  else
    # A taker that died inside the takeover leaves its folder: after 10 s of waiting for it, it is stale.
    guard_tries=$((${guard_tries:-0} + 1))
    if [ "$guard_tries" -ge 10 ]; then rm -rf "$1.takeover"; guard_tries=0; fi
    sleep 1
  fi
  return 0
}

release_lock() {
  rm -rf "$data/.lock"
  locked=0
}

quoted() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# Remembers the folders `mkdir -p "$1"` is about to make, deepest first, for cleanup to take back.
note_made() {
  d=$1
  while [ ! -d "$d" ]; do
    made="${made:+$made
}$d"
    d=$(dirname "$d")
  done
  return 0
}

# What an interrupted install left: hidden unpack folders, DuckDB's partial folders. The lock is held: none is live.
sweep_leftovers() {
  for left in "$data/versions"/.unpack-* "$data/duckdb"/*.partial-*; do
    [ ! -e "$left" ] || rm -rf "$left"
  done
  return 0
}

install_release() {
  begin "Downloading $file"
  rc=0
  live=0
  if [ -t 2 ] && [ "${TERM:-}" != dumb ]; then live=1; fi
  [ "$live" = 0 ] || printf '  %s Downloading %s\n' "$M_ARROW" "$file" >&2
  fetch "$folder/$file" "$tmp/$file" 1 || rc=$?
  [ "$live" = 0 ] || printf '\033[1A\r\033[K' >&2
  [ "$rc" = 0 ] || fail "The download failed: $why." "Check your network, then run the installer again."
  ok "Downloaded" "$file, $(mb "$size")"

  # Nothing is unpacked unless the tarball is byte for byte the one the manifest describes.
  begin "Checking the download"
  got_size=$(wc -c < "$tmp/$file" | tr -d ' ')
  if [ "$got_size" -lt "$size" ]; then
    fail "The download is incomplete: $got_size bytes, the release says $size." "Nothing was installed. Run the installer again; if it fails again, report it."
  elif [ "$got_size" -gt "$size" ]; then
    fail "The download is larger than the release says: $got_size bytes, not $size." "Nothing was installed. Run the installer again; if it fails again, the release is damaged: report it."
  fi
  got_sum=$(sha256 "$tmp/$file")
  if [ "$got_sum" != "$sum" ]; then
    fail "The download does not match its checksum.
    expected  $sum
    received  $got_sum" "Nothing was installed. Run the installer again; if it fails again, the release is damaged: report it."
  fi
  ok "Checksum verified" "SHA-256 and size match the release"

  begin "Unpacking"
  [ -d "$data/versions" ] || note_made "$data/versions"
  mkdir -p "$data/versions"
  work=$(mktemp -d "$data/versions/.unpack-$release.XXXXXX")
  top=${file%.tar.gz}
  tar -xzf "$tmp/$file" -C "$work" 2>/dev/null || { rm -rf "$work"; fail "The download could not be unpacked." "Check the free disk space, then run the installer again."; }
  [ -x "$work/$top/bin/$name" ] || { rm -rf "$work"; fail "The download does not hold bin/$name." "The release looks wrong; report it."; }
  changed=1
  rm -rf "$dest"
  mv "$work/$top" "$dest"
  rm -rf "$work"
  work=""
  [ -x "$dest/bin/$name" ] || fail "$(show_path "$dest_shown") is incomplete after unpacking." "Run the installer again."
  ok "Unpacked" "$(show_path "$dest_shown")"
}

link_launcher() {
  begin "Linking the command"
  mkdir -p "$bin_dir"
  # A new link renamed over the old one: the command is never missing, even for a moment.
  ln -s "$dest/bin/$name" "$bin_dir/.$name.new.$$"
  mv -f "$bin_dir/.$name.new.$$" "$launcher"
  changed=1
  ok "Linked" "$(show_path "$launcher") $M_ARROW $release"
}

path_line() {
  path_note=""
  if [ "$on_path" = 1 ]; then return 0; fi
  if [ "$modify_path" = 0 ]; then
    path_note="skipped"
    return 0
  fi
  begin "Adding $(show_path "$bin_dir") to PATH"
  [ -e "$profile" ] || created=$(add_line "$created" "$profile")
  add_path_line "$profile"
  profiles=$(add_line "$profiles" "$profile")
  path_note="added"
  ok "Added to PATH" "in $(show_path "$profile")"
}

add_line() {
  case "
$1
" in
    *"
$2
"*) printf '%s' "$1" ;;
    *) printf '%s\n%s' "$1" "$2" | sed '/^$/d' ;;
  esac
}

sweep_old() {
  kept="" kept_why=""
  for old in "$data/versions"/*; do
    [ -d "$old" ] || continue
    [ "$old" != "$dest" ] || continue
    v=$(basename "$old")
    is_version "$v" || continue
    if in_use "$v"; then
      kept="${kept:+$kept }$v"
      kept_why="${kept_why:+$kept_why
}$v|$use_mcp|$use_pids"
    else
      rm -rf "$old"
    fi
  done
  return 0
}

# What keeps version $1 and how to let it go: a daemon (its workspaces to restart), an agent's MCP server, another
# process, or processes that could not be listed.
kept_note() {
  restart=$(printf '%s\n' "$old_daemons" | awk -F '\t' -v v="$1" '$1 == v && $2 != "" { print $2 }')
  if [ -n "$restart" ]; then
    note "Kept $1: a daemon still runs from it."
    say "    Restart these workspaces to use $release:"
    while IFS= read -r ws; do
      say "      $C(cd $(show_path "$ws") && $name stop && $name open)$N"
    done <<EOF
$restart
EOF
    [ "$2" = 0 ] || say "    An agent's MCP server also runs from $1: restart the agent."
  elif [ "$3" = "?" ]; then
    note "Kept $1: the running processes could not be listed, so it may still be in use."
    say "    The next install or upgrade removes it once nothing runs from it."
  elif [ "$2" = 1 ]; then
    note "Kept $1: an agent's MCP server still runs from it. Restart the agent to use $release."
  else
    note "Kept $1: a process still runs from it (process $3)."
    say "    The next install or upgrade removes it once nothing runs from it."
  fi
  return 0
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    fail "Neither sha256sum nor shasum is installed, so the download cannot be checked." "Install one of them, then run the installer again."
  fi
}

profile_file() {
  case $(basename "${SHELL:-sh}") in
    zsh) printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) if [ "$(uname -s)" = Darwin ]; then printf '%s' "$HOME/.bash_profile"; else printf '%s' "$HOME/.bashrc"; fi ;;
    fish) printf '%s' "$config_home/fish/config.fish" ;;
    *) printf '%s' "$HOME/.profile" ;;
  esac
}

# A blank line, the marker and the PATH line under it, which `nimbo uninstall` removes together; never added twice.
add_path_line() {
  marker="# added by the nimbo installer"
  if [ -f "$1" ] && grep -qxF "$marker" "$1"; then return 0; fi
  case $bin_dir in
    "$HOME"/*) shown="\$HOME/${bin_dir#"$HOME"/}" ;;
    *) shown=$bin_dir ;;
  esac
  mkdir -p "$(dirname "$1")"
  case $1 in
    *.fish) line="fish_add_path -g \"$shown\"" ;;
    *) line="export PATH=\"$shown:\$PATH\"" ;;
  esac
  if [ -s "$1" ]; then printf '\n%s\n%s\n' "$marker" "$line" >> "$1"; else printf '%s\n%s\n' "$marker" "$line" >> "$1"; fi
}

# A JSON string array of install.json, whatever its spacing, one value per line.
recorded_list() {
  [ -f "$1" ] || return 0
  tr -d '\n\r\t' < "$1" | sed -n "s/.*\"$2\" *: *\[\([^]]*\)\].*/\1/p" | tr ',' '\n' | sed 's/^ *"//; s/" *$//' | sed '/^$/d'
}
recorded_profiles() { recorded_list "$1" profiles; }
recorded_created() { recorded_list "$1" created; }

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

json_list() {
  list=""
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    list="$list${list:+, }$(json_string "$item")"
  done <<ITEMS
$1
ITEMS
  printf '[%s]' "$list"
}

write_record() {
  printf '{ "method": "installer", "bin": %s, "profiles": %s, "created": %s }\n' \
    "$(json_string "$2")" "$(json_list "$3")" "$(json_list "$4")" > "$1.new"
  mv -f "$1.new" "$1"
}

register_mcp() {
  say ""
  say "${B}MCP server$N"
  if PATH="$bin_dir:$PATH" "$launcher" mcp install --agent "$agents" >"$tmp/mcp.out" 2>&1; then
    awk -v a="  $M_OK " -v b="  $M_WARN " -v c="  $M_FAIL " 'index($0, a) == 1 || index($0, b) == 1 || index($0, c) == 1' "$tmp/mcp.out"
  else
    note "The MCP registration did not finish. Run it again with: $name mcp install"
  fi
}

install_duckdb() {
  say ""
  say "${B}DuckDB$N"
  (cd "$HOME" && "$launcher" sql install) || note "DuckDB was not installed. Install it later with: $name sql install"
}

finish() {
  say ""
  say "$G$M_OK$N $B$name $release is installed.$N"
  say ""
  if [ -n "$kept" ]; then
    while IFS='|' read -r v by pids; do
      [ -z "$v" ] || kept_note "$v" "$by" "$pids"
    done <<EOF
$kept_why
EOF
    say ""
  fi
  run="$name"
  if [ "$on_path" = 0 ]; then
    if [ "$path_note" = added ]; then
      say "${Y}Open a new terminal$N, or run this to use $name now:"
      say "    $C$(path_export)$N"
    else
      say "$(show_path "$bin_dir") is not on PATH: run $name by its full path, or add the folder to PATH."
      run=$(show_path "$launcher")
    fi
    say ""
  fi
  say "${B}Next:$N"
  say "    $C$run open$N            ${D}open the current folder as a workspace$N"
  say "    $C$run doctor$N          ${D}check the install$N"
  [ "$mcp" = 1 ] || say "    $C$run mcp install$N     ${D}use it from your agents$N"
  say ""
  say "${D}Update: $name upgrade    Remove: $name uninstall$N"
  say "$D$copyright$N"
}

path_export() {
  case $bin_dir in
    "$HOME"/*) shown="\$HOME/${bin_dir#"$HOME"/}" ;;
    *) shown=$bin_dir ;;
  esac
  case $profile in
    *.fish) printf 'fish_add_path -g "%s"' "$shown" ;;
    *) printf 'export PATH="%s:$PATH"' "$shown" ;;
  esac
}

main "$@"
