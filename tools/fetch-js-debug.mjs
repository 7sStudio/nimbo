// Fetches the pinned js-debug DAP server (microsoft/vscode-js-debug, MIT) into packages/server/vendor/js-debug, where
// the daemon's debugger starts it. Skipped when that version is already there; a download whose SHA-256 differs from
// the pinned one is refused. A failed download only warns: the build goes on and the debugger names this script.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = "1.140.1";
const sha256 = "c72fab31bcbfdce6ad1f42adfd28eff8d4681dd3b03b5e2e6f9e72e6f9927faf";
const url = `https://github.com/microsoft/vscode-js-debug/releases/download/v${version}/js-debug-dap-v${version}.tar.gz`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "packages/server/vendor/js-debug");
const stamp = join(target, "VERSION");

if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version) process.exit(0);

let bytes;
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  bytes = Buffer.from(await response.arrayBuffer());
} catch (error) {
  console.warn(
    `js-debug: could not download ${url} (${String(error)}); the debugger stays unavailable.`,
  );
  process.exit(0);
}

const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== sha256) {
  console.error(`js-debug: ${url} has SHA-256 ${digest}, expected ${sha256}; refused.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "nimbo-js-debug-"));
try {
  const archive = join(work, "js-debug.tar.gz");
  writeFileSync(archive, bytes);
  execFileSync("tar", ["-xzf", archive, "-C", work]);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(work, "js-debug"), target);
  // The release is CommonJS with no package.json of its own; the server package's "type": "module" would apply.
  writeFileSync(join(target, "package.json"), `${JSON.stringify({ type: "commonjs" })}\n`);
  writeFileSync(stamp, `${version}\n`);
  console.log(`js-debug: v${version} in ${target}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
