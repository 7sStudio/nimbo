// Gzips the ui page bundle (every asset the built index.html references, under base /ui/ or none) and fails above 2 MB:
// a tripwire for a large library imported into the first load by accident, not a target. The page is served from
// 127.0.0.1, so its size costs parse time only.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = "packages/ui/dist";
const limit = 2 * 1024 * 1024;
const html = join(dist, "index.html");

if (!existsSync(html)) {
  console.log(
    `size: ${dist} does not exist; run \`pnpm --filter @jsnb/ui build\` first (nothing to measure)`,
  );
  process.exit(0);
}

const refs = [
  ...readFileSync(html, "utf8").matchAll(/(?:src|href)="(?:\/ui)?\/?(assets\/[^"]+\.(?:js|css))"/g),
].map((m) => m[1]);
// output-view's stylesheets, which the page links itself at start (packages/ui/src/main.ts), are part of the first load too
for (const name of readdirSync(join(dist, "assets"))) {
  if (/^(?:style|theme)-.+\.css$/.test(name) && !refs.includes(`assets/${name}`))
    refs.push(`assets/${name}`);
}
let total = 0;
for (const ref of refs) {
  const size = gzipSync(readFileSync(join(dist, ref))).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(8)} KB  ${ref}`);
}
console.log(
  `${(total / 1024).toFixed(1).padStart(8)} KB  total gzipped (tripwire ${limit / 1024} KB)`,
);
if (total > limit) {
  console.error(
    "The page's first load passed the tripwire: look for a large library imported eagerly by accident.",
  );
  process.exit(1);
}
