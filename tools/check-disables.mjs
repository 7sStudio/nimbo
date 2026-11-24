// Counts eslint-disable comments under packages/ and tools/ and fails above the budget of 08-code-standards §1 (twenty).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const budget = 20;
const skip = new Set(["node_modules", "dist", "coverage"]);
const extensions = /\.(ts|mts|cts|js|mjs|cjs|vue)$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (extensions.test(name)) yield path;
  }
}

let count = 0;
for (const root of ["packages", "tools"]) {
  for (const file of walk(root)) {
    const matches = readFileSync(file, "utf8").match(/\/[/*]\s*eslint-disable/g);
    count += matches?.length ?? 0;
  }
}

console.log(`eslint-disable comments: ${count} (budget ${budget})`);
if (count > budget) {
  console.error(`Too many eslint-disable comments: ${count} > ${budget} (08-code-standards §1).`);
  process.exit(1);
}
