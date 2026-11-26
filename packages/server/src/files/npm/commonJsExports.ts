// The named exports of a CommonJS module in the page: the names Node
// gives an `import` of it, found as Node finds them, with Node's own lexer (cjs-module-lexer, from the nodejs
// organisation) over the module's file and, through each re-export it reports (`module.exports = require("./impl")`,
// react's index files), over the file Node's require resolves that to. The bundle of a CommonJS entry then exports
// each name beside `default` and `"module.exports"` (both `module.exports`, as in Node), its value read from
// `module.exports` once the module ran; a name that is no identifier is a string export name. The names are computed
// when the bundle is built and cached with it, per real folder. When the lexer finds nothing or throws, the module
// keeps its default export and its namespace: nothing is refused.
import { createRequire } from "node:module";
import { extname, isAbsolute } from "node:path";

import { init, parse } from "cjs-module-lexer";

import { readRegularFile } from "../regularFile.js";

/** A source file the lexer reads: far above any module's. */
const maxSourceBytes = 64 * 1024 * 1024;

let ready: Promise<void> | undefined;

/** The names of `file` and of the files it re-exports, each file read once (`seen`), as regular files only. */
async function collect(file: string, names: Set<string>, seen: Set<string>): Promise<void> {
  if (seen.has(file)) return;
  seen.add(file);
  const read = await readRegularFile(file, maxSourceBytes);
  if (read.kind !== "read") return; // nothing to read: no names from it
  const found = parse(read.text, file);
  for (const name of found.exports) names.add(name);
  const require = createRequire(file);
  for (const spec of found.reexports) {
    let target: string;
    try {
      target = require.resolve(spec); // Node's own resolution, as its import of the module follows it
    } catch {
      continue; // a re-export Node cannot resolve gives no names
    }
    if (isAbsolute(target) && [".js", ".cjs", ""].includes(extname(target))) {
      await collect(target, names, seen);
    }
  }
}

/** The names Node gives an import of the CommonJS file `file`, `default` aside; none when the lexer throws. */
export async function commonJsNames(file: string): Promise<string[]> {
  try {
    await (ready ??= init());
    const names = new Set<string>();
    await collect(file, names, new Set());
    return [...names].filter((name) => !["default", "module.exports", "__nimboCjs"].includes(name));
  } catch {
    return []; // the lexer failed: the module keeps its default and its namespace
  }
}

/**
 * esbuild's bundle of a CommonJS entry (whose last statement is `export default require_x();`, before the license
 * comments esbuild may append) with the named exports `names` beside its default, as Node's import of it gives them;
 * the text as it is when it holds no such statement.
 */
export function withNamedExports(text: string, names: readonly string[]): string {
  const endings = [...text.matchAll(/^export default (require_[\w$]+)\(\);$/gm)];
  const ending = endings.at(-1);
  if (ending?.[1] === undefined) return text;
  const values = names.map(
    (name, at) =>
      `var __nimboNamed${String(at)} = __nimboModule == null ? void 0 : __nimboModule[${JSON.stringify(name)}];\n`,
  );
  const exported = names.map((name, at) => `__nimboNamed${String(at)} as ${JSON.stringify(name)}`);
  const exports = ["__nimboModule as default", '__nimboModule as "module.exports"', ...exported];
  const statement = `var __nimboModule = ${ending[1]}();\n${values.join("")}export { ${exports.join(", ")} };`;
  return `${text.slice(0, ending.index)}${statement}${text.slice(ending.index + ending[0].length)}`;
}
