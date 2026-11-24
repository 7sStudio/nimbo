// THIRD-PARTY-NOTICES.txt for a release: each bundled package's licence, checked against config.json's allowed list.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { packagesIn, resolveFrom } from "./tree.mjs";

const licenceFiles = (folder) =>
  readdirSync(folder).filter((name) => /^(licen[cs]e|copying|notice)(\.|$|-)/iu.test(name));

/** THIRD-PARTY-NOTICES.txt: Node's licence, then each bundled package with its licence texts, then vendored notices. */
export function thirdPartyNotices(context, versionRoot, app, uiPackages) {
  const { root, config, version, productName } = context;
  const parts = [
    `Third-party software in ${productName} ${version}\n${config.copyright}. ${productName} itself is licensed under ${config.license} (LICENSE).\n`,
    `== Node.js ${config.node.version}\n\n${readFileSync(join(versionRoot, "node", "LICENSE"), "utf8")}`,
  ];
  const seen = new Set();
  const problems = [];
  const packages = [...packagesIn(join(app, "node_modules")), ...uiPackages].sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  );
  for (const [folder, manifest] of packages) {
    const key = `${manifest.name}@${manifest.version}`;
    if (seen.has(key) || manifest.name.startsWith("@jsnb/")) continue;
    seen.add(key);
    const texts = licenceTexts(context, app, folder, manifest);
    problems.push(licenceProblem(config, manifest, texts));
    texts.push(...compiledInNotices(context, manifest));
    parts.push(`== ${key} (${licenceId(config, manifest)})\n\n${texts.join("\n\n")}`);
  }
  const found = problems.filter((problem) => problem !== "");
  if (found.length > 0) throw new Error(`bundled packages' licences:\n  ${found.join("\n  ")}`);
  const fonts = join(root, "packages/ui/src/theme/fonts");
  for (const name of readdirSync(fonts)
    .filter((file) => file.startsWith("OFL-"))
    .sort()) {
    parts.push(
      `== Font: ${name.slice(4, -4)} (OFL-1.1)\n\n${readFileSync(join(fonts, name), "utf8").trim()}`,
    );
  }
  // The server's own THIRD-PARTY-NOTICES.txt is a typed copy of js-debug's licence: the fetched LICENSE goes instead.
  const jsDebug = join(app, "node_modules/@jsnb/server/vendor/js-debug");
  if (existsSync(join(jsDebug, "LICENSE"))) {
    const debugVersion = readFileSync(join(jsDebug, "VERSION"), "utf8").trim();
    parts.push(
      `== js-debug ${debugVersion} (MIT)\n\n${readFileSync(join(jsDebug, "LICENSE"), "utf8").trimEnd()}`,
    );
  }
  return `${parts.join("\n\n")}\n`;
}

const licenceId = (config, manifest) =>
  config.licences.ids[manifest.name] ??
  (typeof manifest.license === "string" ? manifest.license : (manifest.license?.type ?? ""));

/** The licence texts of a package: its own files, else the file or the package config.json names. */
function licenceTexts({ root, config }, app, folder, manifest) {
  const own = licenceFiles(folder).map((name) => readFileSync(join(folder, name), "utf8").trim());
  const elsewhere = config.licences.texts[manifest.name];
  if (own.length > 0 || elsewhere === undefined) return own;
  if (elsewhere.endsWith(".txt"))
    return [readFileSync(join(root, "tools/release", elsewhere), "utf8").trim()];
  const from =
    resolveFrom(app, folder, elsewhere) ??
    resolveFrom(root, join(root, "packages/server"), elsewhere);
  return from === undefined
    ? []
    : licenceFiles(from).map((name) => readFileSync(join(from, name), "utf8").trim());
}

/**
 * The notices of the code compiled into a package (the sources of a WebAssembly build), in `<text>.third-party.txt`
 * beside the licence text config.json names; its first line names the package version they were read for.
 */
function compiledInNotices({ root, config }, manifest) {
  const named = config.licences.texts[manifest.name];
  if (typeof named !== "string" || !named.endsWith(".txt")) return [];
  const file = join(root, "tools/release", named.replace(/\.txt$/u, ".third-party.txt"));
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8").trimEnd();
  if (!text.split("\n", 1)[0].startsWith(`${manifest.name} ${manifest.version}:`))
    throw new Error(
      `${relative(root, file)} is not for ${manifest.name}@${manifest.version}: refresh it from that version's sources`,
    );
  return [text];
}

/** What is wrong with a package's licence: not an allowed one, or no text; else "". */
function licenceProblem(config, manifest, texts) {
  const id = licenceId(config, manifest);
  const ids = id
    .replace(/[()]/gu, " ")
    .split(/\s+(?:OR|AND)\s+|\s+/u)
    .filter((word) => word !== "");
  if (!ids.some((word) => config.licences.allowed.includes(word)))
    return `${manifest.name}@${manifest.version}: licence "${id}" is not in config.json's allowed list`;
  if (texts.length === 0)
    return `${manifest.name}@${manifest.version} (${id}) has no licence text: declare it in config.json licences.texts`;
  return "";
}
