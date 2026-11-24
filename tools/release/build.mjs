// The release build (02-architecture §10): for each target, one tarball nimbo-<version>-<target>.tar.gz holding a
// private Node (the official build, pinned by SHA-256, downloaded once into the cache), the app as a production install
// of the CLI package with a flat node_modules of real package folders (pnpm deploy, hoisted, with only that target's
// platform packages), the UI built for the release, the server's vendor/ folder when there is one, LICENSE, NOTICE,
// THIRD-PARTY-NOTICES.txt, and bin/nimbo. Beside the tarballs: the MCP bundle and its registry entry server.json
// (tools/release/mcpb.mjs), manifest.json and SHA256SUMS (tools/release/manifest.mjs).
//
//   node tools/release/build.mjs [--target host|all|darwin-arm64,...] [--out .release] [--version <v>] [--skip-build]
//
// --version stamps another version than core's (to try an upgrade locally); a release uses core's.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  lstatSync,
  lutimesSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { productName, productVersion } from "../../packages/core/src/product.ts";
import { writeManifest } from "./manifest.mjs";
import { writeBundle } from "./mcpb.mjs";
import { thirdPartyNotices } from "./notices.mjs";
import { checkPrivacy } from "./privacy.mjs";
import { packageOf, packagesIn, resolveFrom, walk, walkDirs } from "./tree.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(join(root, "tools/release/config.json"), "utf8"));
const allTargets = Object.keys(config.node.sha256);

const { values } = parseArgs({
  options: {
    target: { type: "string", default: "host" },
    out: { type: "string", default: join(root, ".release") },
    version: { type: "string" },
    "skip-build": { type: "boolean", default: false },
  },
});

const hostTarget = `${process.platform}-${process.arch}`;
const targets =
  values.target === "all"
    ? allTargets
    : values.target === "host"
      ? [hostTarget]
      : values.target.split(",");
for (const target of targets) {
  if (!allTargets.includes(target))
    throw new Error(`${target} is not a release target (${allTargets.join(", ")})`);
}
const version = values.version ?? productVersion;
const out = resolve(values.out);
const cache = join(out, "cache");
const releaseDir = join(out, "download", `v${version}`);

const sh = (command, args, options = {}) =>
  (
    execFileSync(command, args, {
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
      ...options,
    }) ?? ""
  ).trim();

const git = (...args) => {
  try {
    return sh("git", ["-C", root, ...args]);
  } catch {
    return "";
  }
};
/** The commit's time, every file's time in the tarball; now for a tree with no commit. */
const sourceTime = Number(git("log", "-1", "--format=%ct")) || Math.floor(Date.now() / 1000);
const commit = `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain", "--untracked-files=no") === "" ? "" : "+dirty"}`;

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const log = (text) => process.stderr.write(`${text}\n`);

/** The official Node build for `target`, from the cache or nodejs.org, refused unless its SHA-256 is the pinned one. */
async function nodeTarball(target) {
  const file = join(cache, `node-v${config.node.version}-${target}.tar.gz`);
  const expected = config.node.sha256[target];
  if (!existsSync(file) || sha256(file) !== expected) {
    const url = `https://nodejs.org/dist/v${config.node.version}/node-v${config.node.version}-${target}.tar.gz`;
    log(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
    mkdirSync(cache, { recursive: true });
    writeFileSync(`${file}.part`, Buffer.from(await response.arrayBuffer()));
    renameSync(`${file}.part`, file);
  }
  const found = sha256(file);
  if (found !== expected) {
    rmSync(file);
    throw new Error(`${file}: SHA-256 ${found} is not the pinned ${expected}`);
  }
  return file;
}

/** The Node a release carries: the binary, npm and npx (the package manager for notebook installs), the licence. */
async function addNode(target, into) {
  const work = join(out, "stage", `node-${target}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  sh("tar", ["-xzf", await nodeTarball(target), "-C", work]);
  const unpacked = join(work, `node-v${config.node.version}-${target}`);
  for (const drop of [
    "include",
    "share",
    "README.md",
    "CHANGELOG.md",
    "lib/node_modules/corepack",
    "bin/corepack",
  ]) {
    rmSync(join(unpacked, drop), { recursive: true, force: true });
  }
  renameSync(unpacked, into);
  rmSync(work, { recursive: true, force: true });
}

/**
 * The package folders the app can load: the CLI's dependencies and theirs, transitively, with the overrides of
 * config.json (`runtime`): a package only part of which runs (output-view's model, the UI's built dist) follows only the
 * dependencies listed there. Everything else a production install brought along is never loaded.
 */
function runtimeClosure(app) {
  const kept = new Set();
  const visit = (folder) => {
    if (kept.has(folder)) return;
    kept.add(folder);
    const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
    const deps =
      config.runtime[manifest.name] ??
      Object.keys({
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      });
    for (const dep of deps) {
      const found = resolveFrom(app, folder, dep);
      if (found !== undefined && !pruned(dep)) visit(found);
    }
  };
  visit(app);
  return kept;
}

const pruned = (name) =>
  config.prune.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));

/** Replaces `from` with `to` once in `file`; anything else means the built module changed under the stamp. */
function stamp(file, from, to) {
  const text = readFileSync(file, "utf8");
  if (text.split(from).length !== 2) throw new Error(`${file}: expected exactly one ${from}`);
  writeFileSync(file, text.replace(from, to));
}

/**
 * The UI built for this release (its version and commit stamped in), once for every target, with the packages bundled
 * into it: read from the build's source maps (and the assets config.json names), which then go. Licence comments are
 * stripped by the bundler, so these packages' notices are collected from the packages themselves.
 */
function buildUi() {
  const dist = join(out, "stage", "ui-dist");
  rmSync(dist, { recursive: true, force: true });
  sh(
    "pnpm",
    [
      "--filter",
      "@jsnb/ui",
      "exec",
      "vite",
      "build",
      "--outDir",
      dist,
      "--emptyOutDir",
      "--sourcemap",
    ],
    {
      cwd: root,
      env: { ...process.env, NIMBO_RELEASE_VERSION: version, NIMBO_RELEASE_COMMIT: commit },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  const bundled = new Map();
  const add = (found) => {
    if (found !== undefined && !found[1].name.startsWith("@jsnb/")) bundled.set(found[0], found[1]);
  };
  for (const map of walk(dist).filter((file) => file.endsWith(".map"))) {
    for (const source of JSON.parse(readFileSync(map, "utf8")).sources ?? []) {
      const file = resolve(dirname(map), source.replace(/^[a-z]+:\/\//u, "").replace(/\?.*$/u, ""));
      if (file.includes(`${"/"}node_modules/`)) add(packageOf(file));
    }
    rmSync(map);
  }
  for (const file of walk(dist).filter((path) => /\.(js|css)$/u.test(path))) {
    const text = readFileSync(file, "utf8");
    const bare = text.replace(/\n?\/[/*][#@] sourceMappingURL=[^\n]*$/u, "");
    if (bare !== text) writeFileSync(file, bare);
  }
  for (const [pattern, name] of Object.entries(config.uiAssets)) {
    if (!walk(dist).some((file) => new RegExp(pattern, "u").test(basename(file)))) continue;
    const from = resolveFrom(root, join(root, "packages/query-sql"), name);
    if (from === undefined)
      throw new Error(`the UI asset ${pattern} comes from ${name}, which is not installed`);
    add([from, JSON.parse(readFileSync(join(from, "package.json"), "utf8"))]);
  }
  return { dist, bundled: [...bundled].map(([folder, manifest]) => [folder, manifest]) };
}

/** The manifest fields Node reads when it loads a package; the rest (dependencies, scripts, the builder's paths) go. */
const loadFields = [
  "name",
  "version",
  "type",
  "license",
  "main",
  "module",
  "exports",
  "imports",
  "bin",
  "engines",
];

function trimManifest(file) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const kept = Object.fromEntries(
    loadFields.filter((key) => key in manifest).map((key) => [key, manifest[key]]),
  );
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
}

/** Packages whose declaration files the daemon's language service reads at run time. */
const typesAtRuntime = new Set(config.typesAtRuntime);

/**
 * What the app never loads: source maps, declaration files (but those the language service reads), `@types` packages
 * it does not read, dependencies' test folders, and documentation that is not a licence.
 */
function slim(app) {
  for (const [folder, manifest] of packagesIn(join(app, "node_modules"))) {
    if (!existsSync(folder)) continue;
    if (manifest.name.startsWith("@types/") && !typesAtRuntime.has(manifest.name)) {
      rmSync(folder, { recursive: true, force: true });
      continue;
    }
    for (const name of readdirSync(folder)) {
      if (/^(test|tests|__tests__|docs?)$/u.test(name))
        rmSync(join(folder, name), { recursive: true, force: true });
    }
  }
  const keepTypes = (file) =>
    [...typesAtRuntime].some((name) => file.includes(`/node_modules/${name}/`));
  for (const file of walk(app)) {
    const name = basename(file);
    const doc = /\.(md|markdown)$/iu.test(name) && !/^(licen[cs]e|copying|notice)/iu.test(name);
    const types = /\.d\.[cm]?ts(\.map)?$/u.test(name) && !keepTypes(file);
    if (name.endsWith(".map") || doc || types) rmSync(file, { force: true });
  }
}

/** Every file's times set to the commit's, so the tarball does not carry the build machine's clock. */
function normaliseTimes(dir, time) {
  for (const file of [dir, ...walk(dir)]) lutimesSync(file, time, time);
  for (const folder of [dir, ...walkDirs(dir)]) lutimesSync(folder, time, time);
}

/** The bytes the unpacked version takes. */
const treeSize = (dir) => walk(dir).reduce((total, file) => total + lstatSync(file).size, 0);

async function buildTarget(target, ui) {
  const name = `${productName}-${version}-${target}`;
  const stage = join(out, "stage", target);
  const versionRoot = join(stage, name);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(versionRoot, { recursive: true });
  const [os, cpu] = target.split("-");
  const app = join(versionRoot, "app");
  log(`${target}: deploying the CLI package`);
  sh(
    "pnpm",
    [
      "--filter",
      "@jsnb/cli",
      "deploy",
      "--prod",
      "--node-linker=hoisted",
      "--ignore-scripts",
      "--frozen-lockfile",
      `--os=${os}`,
      `--cpu=${cpu}`,
      "--libc=glibc",
      app,
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
  for (const leftover of [
    "node_modules/.pnpm",
    "node_modules/.modules.yaml",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "node_modules/.bin",
    "node_modules/.pnpm-workspace-state-v1.json",
  ]) {
    rmSync(join(app, leftover), { recursive: true, force: true });
  }
  const kept = runtimeClosure(app);
  for (const [folder, manifest] of packagesIn(join(app, "node_modules"))) {
    if (pruned(manifest.name) || !kept.has(folder))
      rmSync(folder, { recursive: true, force: true });
  }
  const uiFolder = join(app, "node_modules/@jsnb/ui/dist");
  rmSync(uiFolder, { recursive: true, force: true });
  cpSync(ui.dist, uiFolder, { recursive: true });
  const vendor = join(root, "packages/server/vendor");
  const deployedVendor = join(app, "node_modules/@jsnb/server/vendor");
  if (existsSync(vendor) && !existsSync(deployedVendor))
    cpSync(vendor, deployedVendor, { recursive: true });
  const product = join(app, "node_modules/@jsnb/core/dist/product.js");
  stamp(product, `version: "${productVersion}"`, `version: ${JSON.stringify(version)}`);
  stamp(product, 'commit: ""', `commit: ${JSON.stringify(commit)}`);
  const release = {
    name: productName,
    version,
    commit,
    target,
    node: config.node.version,
    releases: config.releases,
  };
  writeFileSync(join(app, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
  trimManifest(join(app, "package.json"));
  for (const [folder, manifest] of packagesIn(join(app, "node_modules"))) {
    if (manifest.name.startsWith("@jsnb/")) trimManifest(join(folder, "package.json"));
  }
  slim(app);
  log(`${target}: adding Node ${config.node.version}`);
  await addNode(target, join(versionRoot, "node"));
  mkdirSync(join(versionRoot, "bin"));
  copyFileSync(join(root, "tools/release/launcher.sh"), join(versionRoot, "bin", productName));
  chmodSync(join(versionRoot, "bin", productName), 0o755);
  copyFileSync(join(root, "LICENSE"), join(versionRoot, "LICENSE"));
  copyFileSync(join(root, "NOTICE"), join(versionRoot, "NOTICE"));
  writeFileSync(
    join(versionRoot, "THIRD-PARTY-NOTICES.txt"),
    thirdPartyNotices({ root, config, version, productName }, versionRoot, app, ui.bundled),
  );
  checkPrivacy(versionRoot, walk(versionRoot), root);
  normaliseTimes(versionRoot, sourceTime);
  mkdirSync(releaseDir, { recursive: true });
  const tarball = join(releaseDir, `${name}.tar.gz`);
  // Owner and group 0 by number, no names: the tarball does not carry the builder's account.
  const ownerFlags =
    process.platform === "darwin"
      ? [
          "--no-mac-metadata",
          "--no-xattrs",
          "--uid",
          "0",
          "--gid",
          "0",
          "--uname",
          "",
          "--gname",
          "",
        ]
      : ["--owner=0", "--group=0", "--numeric-owner", "--sort=name"];
  sh("tar", [...ownerFlags, "-czf", tarball, "-C", stage, name], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const entry = {
    name: productName,
    version,
    commit,
    target,
    file: `${name}.tar.gz`,
    size: statSync(tarball).size,
    unpacked: treeSize(versionRoot),
    sha256: sha256(tarball),
  };
  writeFileSync(join(releaseDir, `${name}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  log(`${target}: ${entry.file}, ${(entry.size / 1048576).toFixed(1)} MiB`);
  return entry;
}

sh("node", [join(root, "tools/release/duckdb-pins.mjs"), "--check"]);
// The debugger's js-debug ships in every release: fetched (or found) now, and its absence fails the build.
sh("node", [join(root, "tools/fetch-js-debug.mjs")], { stdio: ["ignore", "ignore", "inherit"] });
if (!existsSync(join(root, "packages/server/vendor/js-debug/VERSION")))
  throw new Error(
    "packages/server/vendor/js-debug is missing: tools/fetch-js-debug.mjs could not fetch it",
  );
if (!values["skip-build"]) {
  log("building the packages");
  sh("pnpm", ["run", "build"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
}
const ui = buildUi();
for (const target of targets) await buildTarget(target, ui);
log("the MCP bundle and its registry entry");
writeBundle(releaseDir, version);
writeManifest(releaseDir, { name: productName, version, commit });
log(`release in ${releaseDir}`);
