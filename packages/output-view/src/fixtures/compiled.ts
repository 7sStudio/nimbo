// A template class compiled as the build compiles it, for the 08 §7 gate's plants (style.plants.contract.test.ts):
// Tailwind on the views' utilities.css (its prefix, theme and hover variant) with a fresh compiler, since a compiler
// keeps every class it has built; then the build's scope plugin (tailwindScope.ts); then Tailwind's lightningcss pass,
// flattened and minified as dist/style.css is.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile, optimize } from "@tailwindcss/node";
import postcss from "postcss";

import { scopeTailwindProperties } from "@jsnb/style-gate/tailwind-scope";

import { viewerScope } from "../../tailwindScope.js";

const base = fileURLToPath(new URL("../vue/", import.meta.url));
/** utilities.css without its @source: the compiler is handed the class instead of scanning the views. */
const input = readFileSync(join(base, "utilities.css"), "utf8").replace(/@source[^;]*;/u, "");

/** The CSS `className` adds to dist/style.css, with the scope plugin's defaults rule. */
export async function compiled(className: string): Promise<string> {
  const compiler = await compile(input, { base, onDependency: () => undefined });
  const scoped = await postcss([scopeTailwindProperties(viewerScope)]).process(
    compiler.build([className]),
    { from: undefined },
  );
  return optimize(scoped.css, { minify: true }).code;
}
