// Runs one CI stage's test runner (09-testing §9): `vitest <stage>` selects the Vitest projects of that stage,
// `playwright <stage>` every Playwright project named after it (browser-mbp14 …); both print "skipped: no suites yet" and exit 0 when nothing matches.
// For the integration, contract and security stages it first says how many files of that suffix the unit stage runs
// under coverage, so an empty or small stage does not read as missing suites.
import { spawn, spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { join, matchesGlob } from "node:path";

import { excludeOf, includeOf, projects, stageOf } from "./vitest-projects.ts";

/** "<project> <count>" for each unit-stage project that runs files named `*.<suffix>.test.ts`. */
const inUnitStage = (suffix) =>
  projects
    .filter((p) => stageOf(p.name) === "unit")
    .flatMap((p) => {
      const cwd = join(import.meta.dirname, "..", p.root);
      const skip = (name) => name === "node_modules" || name === "dist"; // globSync hands each entry's name only
      const files = includeOf(p)
        .flatMap((pattern) => globSync(pattern, { cwd, exclude: skip }))
        .filter((file) => !excludeOf(p).some((pattern) => matchesGlob(file, pattern)))
        .filter((file) => file.endsWith(`.${suffix}.test.ts`));
      return files.length > 0 ? [`${p.name} ${String(files.length)}`] : [];
    });

/** Notes how many files of the stage's suffix the unit stage runs; answers that count. */
function noteUnitStage(stage) {
  if (!["integration", "contract", "security"].includes(stage)) return 0;
  const counts = inUnitStage(stage);
  const total = counts.reduce((sum, entry) => sum + Number(entry.split(" ").at(-1)), 0);
  if (total > 0)
    console.log(
      `note: ${String(total)} *.${stage}.test.ts files run in the unit stage, under coverage: ${counts.join(", ")}`,
    );
  return total;
}

const [runner, stage, ...extra] = process.argv.slice(2);
const skipped = (what) => {
  console.log(`skipped: no ${what} suites yet`);
  process.exit(0);
};
const status = (cmd, args) =>
  spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" }).status ?? 1;
const run = (cmd, args) => process.exit(status(cmd, args));
/** Starts a command with its output piped, resolving to its exit status and its output, so two run side by side and
 * print one after the other. */
const started = (cmd, args) =>
  new Promise((done) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    child.on("close", (code) => done({ code: code ?? 1, output: Buffer.concat(chunks) }));
  });

// The packages with a coverage floor: the unit stage measures coverage over these projects only and
// runs the others without the v8 instrumentation, which cost most of the stage's time.
const floored = new Set(["core", "transform", "kernel-node", "query-json", "query-sql"]);
const isFloored = (p) => floored.has(p.root.replace(/^packages\//, ""));

if (runner === "vitest") {
  const inUnit = noteUnitStage(stage);
  const names = projects.filter((p) => stageOf(p.name) === stage).map((p) => p.name);
  if (names.length === 0 && inUnit > 0) {
    console.log(
      `skipped: no ${stage} project of its own; those suites ran in the unit stage (above)`,
    );
    process.exit(0);
  }
  if (names.length === 0) skipped(stage);
  const flags = (list) => list.flatMap((n) => ["--project", n]);
  if (stage === "unit" && extra.includes("--coverage")) {
    const measured = projects
      .filter((p) => stageOf(p.name) === "unit" && isFloored(p))
      .map((p) => p.name);
    const rest = names.filter((n) => !measured.includes(n));
    const plain = extra.filter((a) => !a.startsWith("--coverage"));
    // the two runs at once: the measured one waits mostly on its forked kernels, so the other fills the cores
    const runs = await Promise.all([
      started("vitest", ["run", ...flags(measured), ...extra]),
      ...(rest.length > 0 ? [started("vitest", ["run", ...flags(rest), ...plain])] : []),
    ]);
    for (const { output } of runs) process.stdout.write(output);
    process.exit(runs.some(({ code }) => code !== 0) ? 1 : 0);
  }
  run("vitest", ["run", ...flags(names), ...extra]);
}

if (runner === "playwright") {
  const list = spawnSync(
    "playwright",
    ["test", "--list", "--project", `${stage}*`, "--pass-with-no-tests"],
    {
      encoding: "utf8",
    },
  );
  if (
    /Total: 0 tests/.test(list.stdout + list.stderr) ||
    /No tests found/.test(list.stdout + list.stderr)
  )
    skipped(stage);
  // a stage is every project named after it: browser-mbp14, browser-large (one per target screen). By default
  // it runs the 14 inch screen only; BROWSER_SCREENS=all adds the large display.
  const pattern =
    stage === "browser" && process.env.BROWSER_SCREENS !== "all" ? "browser-mbp14" : `${stage}*`;
  run("playwright", ["test", "--project", pattern, ...extra]);
}

if (runner !== "vitest" && runner !== "playwright") {
  console.error(
    "usage: node tools/stage.mjs vitest <unit|integration|contract|security> | playwright <browser|acceptance>",
  );
  process.exit(2);
}
