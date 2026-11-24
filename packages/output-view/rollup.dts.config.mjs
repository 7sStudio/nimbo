// Rolls the declarations tsc and vue-tsc emit into node_modules/.cache/declarations (out of git, lint and format) up
// into one file per entry, dist/index.d.ts and dist/model/index.d.ts, with what they take from @jsnb/core and
// @jsnb/tokens inlined: both are private and bundled into dist, so no published declaration may name them.
// Every other import (vue, zod, reka-ui, the CodeMirror packages) stays.
import { fileURLToPath } from "node:url";

import { dts } from "rollup-plugin-dts";

// The plugin resolves with TypeScript's node10 rules, which do not read package.json "exports": core and tokens are
// mapped to their built declarations, which the root build's tsc -b has written before this runs.
// Raw compiler options reach TypeScript's resolver as they are, so the base is absolute.
const compilerOptions = {
  baseUrl: fileURLToPath(new URL(".", import.meta.url)),
  paths: {
    "@jsnb/core": ["../core/dist/index.d.ts"],
    "@jsnb/tokens": ["../tokens/dist/index.d.ts"],
  },
};

const emitted = "node_modules/.cache/declarations";

/** A package other than core and tokens: kept as an import. The plugin would also keep every file under node_modules,
 * the emitted declarations' folder included, so it respects this list instead. */
const external = (id) =>
  !id.startsWith(".") &&
  !id.startsWith("/") &&
  !id.startsWith("@jsnb/core") &&
  !id.startsWith("@jsnb/tokens");

const entry = (input, file) => ({
  input,
  output: { file, format: "es" },
  external,
  plugins: [dts({ compilerOptions, respectExternal: true })],
});

export default [
  entry(`${emitted}/index.d.ts`, "dist/index.d.ts"),
  entry(`${emitted}/model/index.d.ts`, "dist/model/index.d.ts"),
];
