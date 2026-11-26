// A release folder's index: manifest.json (version, commit, and per target its tarball's name,
// size and SHA-256), SHA256SUMS for every file published (the MCP bundle and server.json too, which mcpb.mjs wrote),
// install.sh, and the Homebrew formula. build.mjs calls it for
// the targets it built; the release workflow calls it once more over the tarballs every runner built.
//
//   node tools/release/manifest.mjs <release folder>
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formula } from "./homebrew/formula.mjs";
import { bundleName } from "./mcpb.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Writes manifest.json, install.sh, the formula and SHA256SUMS into `dir`, from the `<tarball>.json` entries there. */
export function writeManifest(dir, meta) {
  const config = JSON.parse(readFileSync(join(root, "tools/release/config.json"), "utf8"));
  const prefix = `${meta.name}-${meta.version}-`;
  const entries = readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
  if (entries.length === 0) throw new Error(`${dir} holds no ${prefix}<target>.json entry`);
  const targets = Object.fromEntries(
    entries
      .sort((a, b) => a.target.localeCompare(b.target))
      .map(({ target, file, size, unpacked, sha256: sum }) => {
        if (sha256(join(dir, file)) !== sum) throw new Error(`${file} does not match its entry`);
        return [
          target,
          { file, size, ...(unpacked === undefined ? {} : { unpacked }), sha256: sum },
        ];
      }),
  );
  const manifest = { name: meta.name, version: meta.version, commit: meta.commit, targets };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const installer = readFileSync(join(root, "tools/release/install.sh"), "utf8");
  if (!installer.includes(`"${config.releases}"`)) {
    throw new Error(`install.sh's default releases URL is not config.json's ${config.releases}`);
  }
  copyFileSync(join(root, "tools/release/install.sh"), join(dir, "install.sh"));
  writeFileSync(join(dir, `${meta.name}.rb`), formula(manifest, config));
  const mcp = [bundleName(meta.version), "server.json"];
  const absent = mcp.filter((name) => !existsSync(join(dir, name)));
  if (absent.length > 0)
    throw new Error(`${dir} holds no ${absent.join(" or ")} (tools/release/mcpb.mjs)`);
  const listing = JSON.parse(readFileSync(join(dir, "server.json"), "utf8"));
  if (
    listing.version !== meta.version ||
    listing.packages[0]?.fileSha256 !== sha256(join(dir, mcp[0]))
  ) {
    throw new Error(`server.json does not describe ${mcp[0]}`);
  }
  const published = [
    "manifest.json",
    "install.sh",
    `${meta.name}.rb`,
    ...mcp,
    ...Object.values(targets).map((t) => t.file),
  ];
  const sums = published.sort().map((name) => `${sha256(join(dir, name))}  ${name}`);
  writeFileSync(join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);
  return manifest;
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? "");
  const part = readdirSync(dir).find((name) => /-(darwin|linux)-(arm64|x64)\.json$/u.test(name));
  if (part === undefined) throw new Error(`${dir} holds no tarball entry`);
  const { name, version, commit } = JSON.parse(readFileSync(join(dir, part), "utf8"));
  writeManifest(dir, { name, version, commit });
}
