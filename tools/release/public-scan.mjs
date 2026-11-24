// Checks the tracked tree before it is published: no personal name, handle or home path, no internal process
// vocabulary, no citation of a removed document, no `jsnb` used as the command, and every relative Markdown link and
// image resolves. The name and handle are never written here: they come from the environment at run time
// (PUBLIC_SCAN_NAMES, comma-separated, else the last segment of $HOME and the local part of `git config user.email`).
// Exit 1 on any hit; `--links` checks the links only.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const files = git("ls-files", "-z")
  .split("\0")
  .filter((f) => f && existsSync(join(root, f)));
const textual = (f) => !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|wasm|gz|tgz|zip|pdf)$/i.test(f);
const self = "tools/release/public-scan.mjs";

function names() {
  const fromEnv = process.env.PUBLIC_SCAN_NAMES?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  const out = [];
  const home = process.env.HOME ? basename(process.env.HOME) : "";
  if (home && !/^(root|runner|user|ubuntu|node)$/i.test(home)) out.push(home);
  try {
    const local = git("config", "user.email")
      .split("@")[0]
      .replace(/^\d+\+/, "");
    // an identity named after the repository's own owner is the public one, not a personal handle
    const owner = /[:/]([^/:]+)\/[^/]+$/.exec(git("remote", "get-url", "origin"))?.[1] ?? "";
    const isOwner = local.toLowerCase() === owner.toLowerCase();
    if (local.length > 3 && !/noreply/i.test(local) && !isOwner) out.push(local);
  } catch {
    // no git identity: the name from $HOME only
  }
  return out;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const personal = names().map((n) => new RegExp(`\\b${esc(n)}\\b`, "i"));

// Placeholders a document may use for a home folder, and Homebrew's prefix on Linux.
const placeholderHome =
  /^\/(Users|home)\/(me|you|user|name|<[^>]+>|\$USER|runner|alice|bob|linuxbrew)(\/|$)/;
const checks = [
  ["home path", /(?<![\w.~/-])\/(?:Users|home)\/[A-Za-z][\w.-]*/g, (m) => !placeholderHome.test(m)],
  ["process word", /\b(?:JUDGE|HANDOFF|Judge's|the Judge|Coder|Reviewer's|Reviewer)\b/g],
  ["wave as process", /\b(?:wave \d|waves? of the|the (?:ui |redesign's )?wave)\b/gi],
  ["decision number", /(?<![\w-])R\d{1,3}(?: items? \d+)?(?![\w-])/g],
  [
    "process note",
    /\b(?:testing notes? \d|review round \d|round \d+,? items? \d|fixes-\d+\.md|ruling \d+)\b/gi,
  ],
  [
    "removed document",
    /\b(?:01-use-cases|06-ui|10-output-view|13-language-service|14-source-control)\b|decision-log\.md|docs\/history\//g,
  ],
  [
    "jsnb as a command",
    /(?:^|[\s`'"(])jsnb (?:open|add|run|cell|notebook|outputs|serve|stop|status|doctor|mcp|config|feedback|install|uninstall|update|git|diff|sql|workspace|events|keybindings|secrets?|debug|kernel|packages|cache|help|new|list|logs|version|--)\b/gm,
  ],
  ["jsnb env var", /\bJSNB_[A-Z_]+\b/g],
];

let hits = 0;
const report = (f, line, kind, text) => {
  hits++;
  console.log(`${f}:${line}: ${kind}: ${text.trim().slice(0, 160)}`);
};
const linksOnly = process.argv.includes("--links");
for (const f of files) {
  if (f === self || !textual(f)) continue;
  const text = readFileSync(join(root, f), "utf8");
  if (text.includes("\0")) continue;
  const lines = text.split("\n");
  if (!linksOnly) {
    // third-party licence texts are kept verbatim
    const thirdParty = /licences\/|THIRD-PARTY|NOTICE$/.test(f);
    lines.forEach((l, i) => {
      for (const re of personal)
        if (re.test(l)) report(f, i + 1, "personal name", l.replace(re, "<name>"));
      if (thirdParty) return;
      for (const [kind, re, keep = () => true] of checks) {
        for (const m of l.matchAll(re)) if (keep(m[0])) report(f, i + 1, kind, l);
      }
    });
    for (const re of personal) if (re.test(f)) report(f, 0, "personal name in a file name", "");
  }
  if (f.endsWith(".md")) {
    lines.forEach((l, i) => {
      for (const m of l.matchAll(
        /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img[^>]*\bsrc="([^"]+)"/g,
      )) {
        const target = (m[1] ?? m[2]).split("#")[0];
        if (!target || /^[a-z][a-z+.-]*:/i.test(target) || target.startsWith("//")) continue;
        const path = target.startsWith("/")
          ? join(root, target)
          : join(root, dirname(f), decodeURIComponent(target));
        if (!existsSync(path)) report(f, i + 1, "broken link", target);
      }
    });
  }
}
console.log(
  hits === 0 ? `public scan: ${files.length} files, no hits` : `public scan: ${hits} hits`,
);
process.exit(hits === 0 ? 0 : 1);
