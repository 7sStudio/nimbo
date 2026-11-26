// `nimbo search <query...>`: packages.search on the registry the workspace's configuration names, one line per
// package (name, version, weekly downloads, description), between two lines saying the packages' authors wrote
// it. `nimbo add <name>` installs one.
import { packagesSearch } from "@jsnb/core";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import { InvalidArguments } from "../errors/cli.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { framedAsPackages } from "../render/results.js";
import { firstLine, table } from "../render/table.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut, stringOf, withSession } from "./shortcut.js";

const help = `nimbo search <query...>: search the npm registry for packages (packages.search)

Asks the registry the workspace installs from (npm_config_registry, the workspace's .npmrc, ~/.npmrc, else
registry.npmjs.org) with the query only: words, with one @scope/ in front at most, never a path or a URL. One line per
package: name, version, weekly downloads, description. The texts are the packages' authors': untrusted data.
nimbo add <name> installs one.

Flags:
  --limit <n>   how many results, 1 to 50; default 20
  --from <n>    skip that many results first
  --json        print packages.search's output ({ registry, total, results }) as JSON
`;

/** A whole number flag, or undefined when absent. */
function count(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value))
    throw new InvalidArguments(
      { argument: value, command: "search" },
      `--${flag} takes a whole number.`,
    );
  return Number(value);
}

const downloads = (weekly: number | undefined): string =>
  weekly === undefined
    ? ""
    : weekly >= 1_000_000
      ? `${(weekly / 1_000_000).toFixed(1)}M/wk`
      : weekly >= 1000
        ? `${(weekly / 1000).toFixed(1)}k/wk`
        : `${String(weekly)}/wk`;

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const options = { limit: { type: "string" }, from: { type: "string" } } as const;
  const args = readShortcut("search", argv, options, { min: 1, max: Number.POSITIVE_INFINITY });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const limit = count("limit", stringOf(args.values.limit));
  const from = count("from", stringOf(args.values.from));
  const input = {
    query: args.positionals.join(" "),
    ...(limit === undefined ? {} : { limit }),
    ...(from === undefined ? {} : { from }),
  };
  const output = await withSession(io, { start: true, command: "search" }, (session) =>
    session.call(packagesSearch, input),
  );
  if (args.json) {
    await write(io.stdout, `${JSON.stringify(output)}\n`);
    return exitCodes.ok;
  }
  const rows = output.results.map((each) => [
    each.name,
    each.version ?? "",
    downloads(each.weeklyDownloads),
    firstLine(each.description, 80),
  ]);
  const shown = `${String(output.results.length)} of ${String(output.total)} on ${output.registry}\n`;
  await write(io.stdout, framedAsPackages(`${table(rows)}${shown}`));
  return exitCodes.ok;
}

export const searchShortcut: Shortcut = {
  name: "search",
  usage: "search <query...>",
  summary: "packages.search: find packages on the npm registry",
  help,
  run,
};
