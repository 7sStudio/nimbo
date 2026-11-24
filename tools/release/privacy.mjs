// The release build's privacy check (build.mjs, 02-architecture §10): the staged tree must not name the build machine.
import { lstatSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { relative } from "node:path";

const wordChar = String.raw`[\p{L}\p{N}_]`;
const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * Fails the release when the staged tree names the build machine: its home folder, the checkout's path, a word of
 * NIMBO_RELEASE_DENY (comma-separated) or of the file NIMBO_RELEASE_DENYLIST (one per line), which keep such words out
 * of the repository, or the login name. Text files are matched ignoring case; binary files (a NUL in their first 8 KiB)
 * as bytes, in the word's own, lower, upper and capitalised spellings. A word of one or two characters, and the login
 * name, must stand alone (no letter, digit or _ on either side), and are looked for in text files only: Node's binary
 * and DuckDB's WebAssembly hold nearly every short word standing alone. A login name of fewer than four characters is
 * not looked for, standing alone in third-party code and licences too often; listed in NIMBO_RELEASE_DENY, it is. On a
 * CI runner (CI=true) binaries are not searched for the home folder: it is every runner's, and DuckDB-WASM's build,
 * made on such a runner, names it.
 */
export function checkPrivacy(dir, files, root) {
  const listed = [
    ...(process.env.NIMBO_RELEASE_DENY ?? "").split(","),
    ...(process.env.NIMBO_RELEASE_DENYLIST
      ? readFileSync(process.env.NIMBO_RELEASE_DENYLIST, "utf8").split("\n")
      : []),
  ]
    .map((word) => word.trim())
    .filter((word) => word !== "" && !word.startsWith("#"));
  const user = userInfo().username;
  const ciHome = process.env.CI === "true" ? homedir() : undefined;
  const needles = [
    ...[homedir(), root, ...listed].map((word) => ({
      word,
      alone: word.length < 3,
      binary: word.length >= 3 && word !== ciHome,
    })),
    ...(user.length >= 4 ? [{ word: user, alone: true, binary: false }] : []),
  ].map(({ word, alone, binary }) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const spellings = [word, word.toLowerCase(), word.toUpperCase(), capitalise(word)];
    return {
      word,
      alone,
      pattern: new RegExp(alone ? `(?<!${wordChar})${escaped}(?!${wordChar})` : escaped, "iu"),
      bytes: binary ? [...new Set(spellings)].map((spelling) => Buffer.from(spelling)) : [],
    };
  });
  const found = [];
  for (const file of files) {
    if (lstatSync(file).isSymbolicLink()) continue;
    const bytes = readFileSync(file);
    const binary = bytes.subarray(0, 8192).includes(0);
    const text = binary ? "" : bytes.toString("utf8");
    for (const needle of needles) {
      const hit = binary
        ? needle.bytes.some((spelling) => bytesInclude(bytes, spelling, needle.alone))
        : needle.pattern.test(text);
      if (hit) found.push(`${relative(dir, file)} (${needle.word})`);
    }
  }
  if (found.length > 0) {
    throw new Error(
      `the staged release names the build machine:\n  ${found.slice(0, 20).join("\n  ")}`,
    );
  }
}

/** Whether `needle` is in `bytes`; `alone`: with no ASCII letter, digit or _ (nor a byte of a UTF-8 letter) beside it. */
function bytesInclude(bytes, needle, alone) {
  const wordByte = (at) =>
    at >= 0 && at < bytes.length && /[\w\x80-\xff]/u.test(String.fromCharCode(bytes[at]));
  for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + 1)) {
    if (!alone || (!wordByte(at - 1) && !wordByte(at + needle.length))) return true;
  }
  return false;
}
