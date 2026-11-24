#!/usr/bin/env bash
# The release checks, against built artefacts (tools/release/build.mjs) and in a throwaway HOME, with only that HOME's
# ~/.local/bin and the system folders on PATH, so nothing of the machine's own Node, pnpm or config is used:
#
#   tools/release/check.sh smoke <release root> <version>       install with curl | sh from a local server, doctor,
#                                                                 a notebook run headless, the installer's flags and
#                                                                 refusals (bad versions, a forged manifest, a wrong
#                                                                 checksum, a second installer at once), the MCP
#                                                                 bundle without and with nimbo, uninstall
#   tools/release/check.sh full <release root> <v1> <v2>         the whole flow: idempotent installs, a notebook
#                                                                 package, SQL without and with DuckDB (command and page),
#                                                                 the page with Playwright, upgrade under a running daemon,
#                                                                 mcp install, uninstall and --purge (needs the npm registry)
#
# The release server and Playwright run on the Node found on the caller's PATH; CHECK_WORK keeps the scratch folder.
set -euo pipefail

mode=${1:?smoke or full}
root=$(cd "${2:?release root}" && pwd)
v1=${3:?version}
v2=${4:-}
repo=$(cd "$(dirname "$0")/../.." && pwd)
outer_node=$(command -v node)
tmp_root=${TMPDIR:-/tmp}
work=${CHECK_WORK:-$(mktemp -d "${tmp_root%/}/nimbo-check.XXXXXX")}
home="$work/home"
ws="$work/ws"
rm -rf "$home" "$ws"
mkdir -p "$home" "$ws"
data="$home/.local/share/nimbo"
launcher="$home/.local/bin/nimbo"
server_pid=""

say() { printf '\n== %s\n' "$1"; }
fail() {
  printf 'CHECK FAILED: %s\n' "$1" >&2
  exit 1
}

# Everything the installed app sees: the scratch HOME, the system PATH, nothing else from the caller.
clean_env=(env -i "HOME=$home" "PATH=$home/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin" "SHELL=/bin/bash"
  "USER=${USER:-nimbo}" "LANG=en_US.UTF-8" "TMPDIR=${TMPDIR:-/tmp}" "NIMBO_INSTALL_BASE=http://127.0.0.1:PORT")
n() { (cd "$ws" && "${clean_env[@]/PORT/$port}" nimbo "$@"); }

cleanup() {
  set +e
  if [ -x "$launcher" ]; then n stop >/dev/null 2>&1; fi
  # any process still running from the scratch install
  pkill -f "$home/.local/share/nimbo/versions/" 2>/dev/null
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null
  [ -n "${CHECK_WORK:-}" ] || rm -rf "$work"
}
trap cleanup EXIT

say "release server for $root"
"$outer_node" "$repo/tools/release/serve.mjs" "$root" "$v1" >"$work/port" 2>"$work/server.log" &
server_pid=$!
for _ in $(seq 50); do [ -s "$work/port" ] && break; sleep 0.1; done
port=$(cat "$work/port")
base="http://127.0.0.1:$port"
echo "$base (latest: $v1)"

# As a new user runs it: ~/.local/bin not yet on PATH, so the installer adds its line to the profile. No terminal is
# ever given (stdin closed, output captured), so nothing is asked; --yes says so for a caller at a terminal too.
install() {
  "${clean_env[@]/PORT/$port}" PATH=/usr/bin:/bin:/usr/sbin:/sbin sh -c "curl -fsSL '$base/latest/download/install.sh' | sh -s -- --yes $*" </dev/null
}
# The installer as a script from the release folder, with the scratch HOME's PATH (~/.local/bin on it); `with` adds
# environment variables after the clean ones (env -i would drop any set before it).
installer() { "${clean_env[@]/PORT/$port}" sh "$root/download/v$v1/install.sh" "$@" </dev/null; }
with() { # VAR=value... -- command...
  local vars=()
  while [ "$1" != -- ]; do vars+=("$1"); shift; done
  shift
  "${clean_env[@]/PORT/$port}" "${vars[@]}" "$@" </dev/null
}
esc=$(printf '\033')
# `<command...>` prints exactly one JSON document on stdout, nothing else (human text, if any, on stderr).
one_json() {
  "$@" >"$work/json.out" 2>"$work/json.err" || { cat "$work/json.out" "$work/json.err"; fail "failed: $*"; }
  "$outer_node" -e 'JSON.parse(require("node:fs").readFileSync(0, "utf8"))' <"$work/json.out" ||
    { cat "$work/json.out"; fail "stdout is not one JSON document: $*"; }
}

bundle="$root/download/v$v1/nimbo-mcp-$v1.mcpb"
# The MCP bundle as a desktop client runs it (tools/release/mcpb-check.mjs): the client's own Node, the scratch HOME, and
# the system PATH alone, without ~/.local/bin, so the launcher must find nimbo where the installer put it.
bundle_check() {
  "${clean_env[@]/PORT/$port}" PATH=/usr/bin:/bin:/usr/sbin:/sbin "$outer_node" "$repo/tools/release/mcpb-check.mjs" "$bundle" "$ws" "$@" </dev/null
}
say "the MCP bundle before nimbo is installed"
[ -f "$bundle" ] || fail "no MCP bundle at $bundle"
system_nimbo=$(ls /opt/homebrew/bin/nimbo /usr/local/bin/nimbo /home/linuxbrew/.linuxbrew/bin/nimbo 2>/dev/null | head -1 || true)
if [ -z "$system_nimbo" ]; then bundle_check missing; else echo "skipped: this machine has $system_nimbo, which the bundle finds"; fi

say "install with curl | sh"
install | tee "$work/install.log"
[ -L "$launcher" ] || fail "no launcher at $launcher"
! grep -q "$esc" "$work/install.log" || fail "the installer wrote escape codes into a pipe"
grep -q "is installed" "$work/install.log" || fail "the installer did not say it installed"
command_on_path=$("${clean_env[@]/PORT/$port}" sh -c 'command -v node || true')
[ -z "$command_on_path" ] || fail "a system node is on the clean PATH: $command_on_path"

say "nimbo --version and doctor"
n --version | tee "$work/version"
grep -q "nimbo $v1 (" "$work/version" || fail "--version is not $v1"
grep -q "installer" "$work/version" || fail "--version does not say installer"
n doctor

say "--json: one JSON document on stdout"
one_json n doctor --json
one_json "${clean_env[@]/PORT/$port}" sh -c 'cd && nimbo sql status --json'
one_json n mcp install --print --json
one_json n upgrade --check --json
echo "doctor, sql status (no daemon), mcp install --print, upgrade --check"

say "a notebook run headless"
n notebook create --path smoke.jsnb >/dev/null
n cell add -n smoke.jsnb --type server --id c_a1b2c3 --source 'const answer = 6 * 7; answer' --run >/dev/null
n outputs c_a1b2c3 -n smoke.jsnb --format json | tee "$work/answer"
grep -q 42 "$work/answer" || fail "the server cell did not answer 42"

say "the MCP bundle with nimbo installed"
bundle_check installed "$v1"

say "the installer's refusals: nothing is changed"
target_link=$(readlink "$launcher")
expect_fail() { # <what the output must say> <command...>
  local what=$1
  shift
  set +e
  "$@" >"$work/refused" 2>&1
  local code=$?
  set -e
  [ "$code" != 0 ] || fail "accepted: $*"
  grep -q "$what" "$work/refused" || { cat "$work/refused"; fail "no \"$what\" from: $*"; }
}
expect_fail "does not exist" installer --version 9.9.9
expect_fail "is not a version" installer --version '../../x'
expect_fail "does not exist" n upgrade --version 9.9.9 --yes
expect_fail "is not a version" n upgrade --version '../x' --yes
expect_fail "must be an absolute path" with NIMBO_BIN_DIR=relative/bin -- sh "$root/download/v$v1/install.sh" --yes
# A forged release: a manifest whose version would lead out of the versions folder, one that answers another
# version than the one asked for, and a tarball whose checksum is wrong.
evil="$work/evil"
mkdir -p "$evil/download/v9.0.0" "$evil/download/v9.0.1" "$evil/download/v9.0.2"
echo keep >"$data/canary"
manifest() { printf '{"name":"nimbo","version":"%s","commit":"x","targets":{"%s":{"file":"nimbo-%s-%s.tar.gz","size":%s,"sha256":"%s"}}}' "$@"; }
host=$(sed -n 's/.*"\([a-z]*-[a-z0-9]*\)": *{.*/\1/p' "$root/download/v$v1/manifest.json" | head -1)
manifest "x/../../canary" "$host" 9.0.0 "$host" 10 "$(printf '0%.0s' $(seq 64))" >"$evil/download/v9.0.0/manifest.json"
manifest "$v1" "$host" "$v1" "$host" 10 "$(printf '0%.0s' $(seq 64))" >"$evil/download/v9.0.1/manifest.json"
printf 'not a tarball' >"$evil/download/v9.0.2/nimbo-9.0.2-$host.tar.gz"
manifest 9.0.2 "$host" 9.0.2 "$host" 13 "$(printf '0%.0s' $(seq 64))" >"$evil/download/v9.0.2/manifest.json"
mkdir -p "$evil/download/v9.0.3"
printf 'not a tarball' >"$evil/download/v9.0.3/nimbo-9.0.3-$host.tar.gz"
manifest 9.0.3 "$host" 9.0.3 "$host" 5 "$(printf '0%.0s' $(seq 64))" >"$evil/download/v9.0.3/manifest.json"
forged() { with NIMBO_INSTALL_BASE="file://$evil" -- "$@"; }
expect_fail "larger than the release says" forged sh "$root/download/v$v1/install.sh" --version 9.0.3 --yes
expect_fail "invalid version" forged sh "$root/download/v$v1/install.sh" --version 9.0.0 --yes
expect_fail "expected shape" forged nimbo upgrade --version 9.0.0 --yes
expect_fail "holds nimbo $v1" forged sh "$root/download/v$v1/install.sh" --version 9.0.1 --yes
expect_fail "holds nimbo $v1" forged nimbo upgrade --version 9.0.1 --yes
expect_fail "does not match its checksum" forged sh "$root/download/v$v1/install.sh" --version 9.0.2 --yes
expect_fail "does not match its checksum" forged nimbo upgrade --version 9.0.2 --yes
[ "$(cat "$data/canary")" = keep ] || fail "a forged manifest touched $data/canary"
rm "$data/canary"
[ "$(readlink "$launcher")" = "$target_link" ] && [ -x "$launcher" ] || fail "a refused install moved the launcher"
echo "refused: unknown and invalid versions, a relative NIMBO_BIN_DIR, forged manifests, a wrong checksum"

say "two installers at once: one installs, the other says why it stopped, the install stays whole"
set +e
installer --yes >"$work/par1" 2>&1 &
first=$!
installer --yes >"$work/par2" 2>&1
second=$?
wait "$first"
first=$?
set -e
[ "$first" = 0 ] || [ "$second" = 0 ] || fail "neither installer finished"
cat "$work/par1" "$work/par2" | grep -q "Another nimbo install or upgrade is running" || [ "$first$second" = 00 ] ||
  fail "the losing installer did not say why"
[ -x "$data/versions/$v1/bin/nimbo" ] && [ -x "$launcher" ] || fail "the parallel installers broke the install"

say "the installer's flags, without a terminal"
mkdir -p "$data/versions/.unpack-$v1-left"
n doctor >"$work/doctor" || true
grep -q "left by an interrupted install" "$work/doctor" || fail "doctor did not report the leftover unpack folder"
installer --no-modify-path --no-mcp --no-duckdb --version "$v1" >/dev/null
[ ! -e "$data/versions/.unpack-$v1-left" ] || fail "the installer left a stale unpack folder"
with NIMBO_NO_MODIFY_PATH=1 NIMBO_MCP=0 NIMBO_DUCKDB=0 NIMBO_VERSION="$v1" -- sh "$root/download/v$v1/install.sh" >/dev/null
with PATH=/usr/bin:/bin:/usr/sbin:/sbin -- sh "$root/download/v$v1/install.sh" --yes --profile '~/.custom_profile' >/dev/null
grep -q "^# added by the nimbo installer$" "$home/.custom_profile" || fail "--profile did not get the PATH line"
installer --help >"$work/help"
grep -q -- "--no-modify-path" "$work/help" || fail "--help does not list the options"
installer --bogus >/dev/null 2>&1 && fail "an unknown option was accepted"
echo "flags and environment variables: --no-modify-path --no-mcp --no-duckdb --version --profile --help"

say "a re-run with ~/.local/bin on PATH keeps the record of the profile lines"
installer --yes >/dev/null
grep -q '\.custom_profile' "$data/install.json" || fail "the re-run lost the profile record"

say "a re-install while an older version runs: kept, with the reason, and the install still finishes"
old_v=0.0.1
if [ "$(uname -s)" = Darwin ]; then cp -cR "$data/versions/$v1" "$data/versions/$old_v"; else cp -al "$data/versions/$v1" "$data/versions/$old_v"; fi
# an agent's MCP server from the old version, its stdin held open as an agent does
mkfifo "$work/mcp.in"
"${clean_env[@]/PORT/$port}" "$data/versions/$old_v/bin/nimbo" mcp <"$work/mcp.in" >/dev/null 2>&1 &
mcp_pid=$!
exec 3>"$work/mcp.in"
sleep 2
installer --yes >"$work/kept" 2>&1 || { cat "$work/kept"; fail "the installer failed with an old version's MCP server running"; }
grep -q "Kept $old_v: an agent's MCP server still runs from it" "$work/kept" || { cat "$work/kept"; fail "no MCP reason for the kept version"; }
grep -q "Next:" "$work/kept" || fail "the installer stopped before its Next block"
exec 3>&-
pkill -P "$mcp_pid" 2>/dev/null || true
kill "$mcp_pid" 2>/dev/null || true
wait "$mcp_pid" 2>/dev/null || true
# a Node started through an alias link to the data folder runs from the version all the same
ln -s "$data" "$work/alias-data"
"$work/alias-data/versions/$old_v/node/bin/node" -e 'setTimeout(() => {}, 120000)' &
alias_pid=$!
installer --yes >"$work/kept" 2>&1 || { cat "$work/kept"; fail "the installer failed with an aliased Node running"; }
grep -q "Kept $old_v: a process still runs from it (process $alias_pid)" "$work/kept" || { cat "$work/kept"; fail "an aliased Node was not seen"; }
kill "$alias_pid"
wait "$alias_pid" 2>/dev/null || true
installer --yes >/dev/null
[ ! -d "$data/versions/$old_v" ] || fail "$old_v was not removed once nothing ran from it"
rm "$work/alias-data"
echo "kept for an MCP server and for an aliased Node, removed after"

say "the lock: a reused pid is taken over, a live holder is named with the lock's path"
sleep 120 &
holder=$!
mkdir "$data/.lock"
echo "$holder" >"$data/.lock/pid"
echo "Mon Jan  1 00:00:00 2001" >"$data/.lock/started"
installer --yes >/dev/null || fail "a lock whose pid names another process blocked the installer"
mkdir "$data/.lock"
echo "$holder" >"$data/.lock/pid"
LC_ALL=C ps -o lstart= -p "$holder" | sed 's/^ *//; s/ *$//' >"$data/.lock/started"
expect_fail "If none is running, remove the lock: rm -r '.*/nimbo/.lock'" installer --yes
expect_fail "If none is running, remove the lock: rm -r '.*/nimbo/.lock'" forged nimbo upgrade --version 9.0.2 --yes
rm -rf "$data/.lock"
kill "$holder"
wait "$holder" 2>/dev/null || true
echo "reused pid taken over; a live holder named with rm -r of the lock"

if [ "$mode" = smoke ]; then
  n stop
  say "uninstall"
  one_json n uninstall --yes --json
  [ ! -e "$launcher" ] || fail "the launcher is still there"
  [ ! -e "$data" ] || fail "$data is still there"
  ! grep -qs "nimbo installer" "$home/.bashrc" "$home/.bash_profile" "$home/.custom_profile" ||
    fail "a PATH line is still there"
  for created in .bash_profile .bashrc .custom_profile; do
    [ ! -e "$home/$created" ] || fail "the installer created $created and uninstall left it"
  done
  echo "smoke check passed"
  exit 0
fi

[ -n "$v2" ] || fail "full needs a second version"

say "installer run twice more: idempotent"
target_before=$(readlink "$launcher")
install >/dev/null
install >/dev/null
[ "$(readlink "$launcher")" = "$target_before" ] || fail "the launcher moved"
[ "$(grep -c '^# added by the nimbo installer$' "$home/.bashrc" "$home/.bash_profile" 2>/dev/null | awk -F: '{ s += $2 } END { print s }')" = 1 ] ||
  fail "the PATH line is not there exactly once"
ls "$data/versions"

say "a notebook package through the bundled npm (nimbo add zod)"
n add zod
n cell add -n smoke.jsnb --type server --id c_d4e5f6 --source 'import { z } from "zod"; z.string().parse("zod works")' --run >/dev/null
n outputs c_d4e5f6 -n smoke.jsnb --format json | grep -q "zod works" || fail "zod did not load"
echo "zod installed and imported"

say "SQL without DuckDB: the named error"
n cell add -n smoke.jsnb --type server --id c_e5f6a7 --source '[{ a: 1 }, { a: 2 }]' --run >/dev/null
set +e
n outputs c_e5f6a7 -n smoke.jsnb --sql 'select sum(a) as s from t' --format json >"$work/sql.out" 2>"$work/sql.err"
code=$?
set -e
cat "$work/sql.err"
[ "$code" != 0 ] && grep -q "nimbo sql install" "$work/sql.err" || fail "no SqlEngineMissing naming nimbo sql install"

say "the page with Playwright: server output, a client cell, DuckDB installed from Settings"
n cell add -n smoke.jsnb --type client --id c_b2c3d4 --source 'console.log("rendered in the page")' >/dev/null
url=$(n open smoke.jsnb --no-browser --json | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
[ -n "$url" ] || fail "nimbo open gave no URL"
client_env=$(printf '{"HOME":"%s","PATH":"%s/.local/bin:/usr/bin:/bin","SHELL":"/bin/bash"}' "$home" "$home")
(cd "$repo" && CLIENT_RUN='["nimbo","cell","run","-n","smoke.jsnb","--cell","c_b2c3d4"]' CLIENT_CWD="$ws" \
  CLIENT_ENV="$client_env" CLIENT_TEXT="rendered in the page" PATH="$home/.local/bin:$PATH" \
  "$outer_node" tools/release/ui-check.mjs "$url" 42 --install-sql)
n outputs c_e5f6a7 -n smoke.jsnb --sql 'select sum(a) as s from t' --format json | tee "$work/sql.ok"
grep -q '"s": *3\|"s":3' "$work/sql.ok" || fail "the SQL query did not answer 3"

say "DuckDB through the command (nimbo sql install), from scratch"
n stop
rm -rf "$data/duckdb"
n sql install --json | tee "$work/sql.install"
grep -q '"installed": *true' "$work/sql.install" || fail "sql install did not install"
n run c_e5f6a7 c_a1b2c3 -n smoke.jsnb >/dev/null
n outputs c_e5f6a7 -n smoke.jsnb --sql 'select sum(a) as s from t' --format json | grep -q '3' || fail "SQL failed after the command"
n sql install --json | grep -q '"installed": *true' || fail "a second sql install failed"

say "upgrade to $v2 while the $v1 daemon runs"
n status >"$work/status0"
head -1 "$work/status0"
curl -fsS -X POST --data "$v2" "$base/latest" >/dev/null
n upgrade --check
set +e
n upgrade --yes >"$work/upgrade.a" 2>&1 &
first=$!
n upgrade --yes >"$work/upgrade.b" 2>&1
wait "$first"
set -e
cat "$work/upgrade.a" "$work/upgrade.b" >"$work/upgrade"
cat "$work/upgrade"
grep -q "nimbo $v2 is installed" "$work/upgrade" || fail "upgrade did not install $v2"
grep -q "Another nimbo install or upgrade is running" "$work/upgrade" || grep -c "is installed" "$work/upgrade" | grep -q 1 ||
  fail "the second upgrade at once did not say why it stopped"
! grep -q "ENOTEMPTY\|Error:" "$work/upgrade" || fail "an upgrade printed a raw error"
grep -q "Kept $v1" "$work/upgrade" || fail "upgrade did not keep the running $v1"
n --version | grep -q "nimbo $v2 (" || fail "the launcher does not run $v2"
[ -d "$data/versions/$v1" ] && [ -d "$data/versions/$v2" ] || fail "both versions should be installed"
n status >"$work/status"
head -1 "$work/status"
grep -q "server $v1" "$work/status" || fail "the old daemon is not the one answering"
n outputs c_a1b2c3 -n smoke.jsnb --format json | grep -q 42 || fail "the old daemon stopped working"
n doctor || true
n stop 2>&1 | tee "$work/stop"
grep -q "Removed $v1" "$work/stop" || fail "$v1 was not removed once its daemon stopped"
[ ! -d "$data/versions/$v1" ] || fail "$v1 is still there"
n upgrade --yes | grep -q "is the latest release" || fail "a second upgrade did something"
one_json n upgrade --yes --json

say "nimbo mcp install --print"
n mcp install --print | tee "$work/mcp"
grep -q "$launcher" "$work/mcp" || fail "the MCP entry does not name the launcher"

say "installer again on $v2: idempotent"
install >/dev/null
ls "$data/versions"

say "a symlinked HOME: a re-run under a running daemon keeps its version"
real_home="$work/realhome"
link_home="$work/linkhome"
mkdir -p "$real_home" "$work/ws2"
ln -s "$real_home" "$link_home"
lenv=(env -i "HOME=$link_home" "PATH=$link_home/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin" "SHELL=/bin/bash"
  "LANG=en_US.UTF-8" "TMPDIR=${TMPDIR:-/tmp}" "NIMBO_INSTALL_BASE=$base")
"${lenv[@]}" sh "$root/download/v$v1/install.sh" --yes --version "$v1" </dev/null >/dev/null
(cd "$work/ws2" && "${lenv[@]}" nimbo open --no-browser --background >/dev/null)
"${lenv[@]}" sh "$root/download/v$v1/install.sh" --yes --version "$v1" </dev/null >"$work/linked"
grep -q "installed and running" "$work/linked" || fail "the installer under a symlinked HOME did not see the running daemon"
(cd "$work/ws2" && "${lenv[@]}" nimbo stop >/dev/null)
"${lenv[@]}" nimbo uninstall --yes </dev/null >/dev/null
[ ! -e "$link_home/.local/bin/nimbo" ] && [ ! -h "$link_home/.local/bin/nimbo" ] || fail "uninstall left the launcher under a symlinked HOME"

say "uninstall: only the user config is left"
n uninstall --yes
[ ! -e "$launcher" ] || fail "the launcher is still there"
[ ! -e "$data" ] || fail "$data is still there"
! grep -q "nimbo installer" "$home/.bashrc" "$home/.bash_profile" 2>/dev/null || fail "the PATH line is still there"
[ -d "$home/.config/nimbo" ] || fail "the user config should stay"
[ -d "$ws/.jsnb" ] || fail "the workspace's .jsnb/ must stay"
(cd "$home" && find . -type f | sort)

say "uninstall --purge"
install >/dev/null
mkdir -p "$data/unrelated" && echo mine >"$data/unrelated/file"
one_json n uninstall --purge --yes --json
[ -f "$data/unrelated/file" ] || fail "--purge removed what nimbo did not create"
rm -rf "$data"
[ ! -e "$home/.config/nimbo" ] || fail "--purge left the user config"
[ ! -e "$data" ] || fail "--purge left $data"
echo "left in the scratch HOME:"
(cd "$home" && find . -type f | sort)
echo "full check passed"
