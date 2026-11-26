// Tests reading a generated subcommand's arguments: flags into input, the global flags, source from
// --source, stdin or --file, and the schema's check before any daemon, its issues named by flag (exit 2).
import { writeFile } from "node:fs/promises";

import {
  cellAdd,
  cellUpdate,
  InvalidParams,
  notebookRun,
  packagesAdd,
  settingsGet,
} from "@jsnb/core";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { InvalidArguments } from "../errors/cli.js";
import { testIo } from "../fixtures/io.js";
import { checkedInput, parseCommandLine, pendingOf, readArgs, validate } from "./parse.js";

const io = (stdin?: string) => testIo({ cwd: "/", ...(stdin === undefined ? {} : { stdin }) });

describe("parseCommandLine", () => {
  it("reads the flags into the input, booleans with --no-, lists repeated, -n for the notebook", async () => {
    const line = await parseCommandLine(
      cellAdd,
      ["-n", "a.jsnb", "--type", "server", "--source", "1", "--no-run", "--after", "null"],
      io(),
    );
    expect(line).toEqual({
      input: { notebook: "a.jsnb", type: "server", source: "1", after: null, run: false },
      json: false,
      yes: false,
      help: false,
    });
    const names = await parseCommandLine(
      packagesAdd,
      ["--names", "a", "--names", "b", "--json", "-y"],
      io(),
    );
    expect(names).toMatchObject({ input: { names: ["a", "b"] }, json: true, yes: true });
  });
});

describe("parseCommandLine", () => {
  it("leaves the notebook to its default and checks the rest with a stand-in", async () => {
    const line = await parseCommandLine(cellAdd, ["--type", "markdown"], io());
    expect(line.input).toEqual({ type: "markdown" });
    expect(pendingOf(cellAdd, line.input)).toEqual({ notebook: "-" });
  });
});

describe("parseCommandLine", () => {
  it("answers --help before reading or checking anything else", async () => {
    expect(await parseCommandLine(cellAdd, ["--help", "--type", "nope"], io())).toMatchObject({
      help: true,
    });
  });
});

describe("parseCommandLine", () => {
  it("reads the source from stdin with --source -, and from a file with --file", async () => {
    const piped = await parseCommandLine(
      cellAdd,
      ["-n", "a", "--type", "server", "--source", "-"],
      io("export const n = 41\n"),
    );
    expect(piped.input.source).toBe("export const n = 41\n");
    await withWorkspace(async (ws) => {
      await writeFile(ws.path("cell.ts"), "1 + 1");
      const read = await parseCommandLine(
        cellAdd,
        ["-n", "a", "--type", "server", "--file", "cell.ts"],
        testIo({ cwd: ws.dir }),
      );
      expect(read.input.source).toBe("1 + 1");
      await expect(
        parseCommandLine(
          cellAdd,
          ["--type", "server", "--file", "missing.ts"],
          testIo({ cwd: ws.dir }),
        ),
      ).rejects.toMatchObject({
        name: "InvalidArguments",
        data: { argument: "--file", command: "cell add" },
      });
    });
    await expect(
      parseCommandLine(cellAdd, ["--type", "server", "--source", "1", "--file", "x"], io()),
    ).rejects.toBeInstanceOf(InvalidArguments);
  });
});

describe("parseCommandLine", () => {
  it("refuses an unknown flag, a missing value and a positional with InvalidArguments", async () => {
    await expect(parseCommandLine(cellAdd, ["--bogus"], io())).rejects.toMatchObject({
      name: "InvalidArguments",
      data: { argument: "--bogus" },
    });
    await expect(parseCommandLine(cellAdd, ["--type"], io())).rejects.toMatchObject({
      data: { argument: "--type" },
    });
    await expect(parseCommandLine(cellAdd, ["c_a1b2c3"], io())).rejects.toBeInstanceOf(
      InvalidArguments,
    );
  });
});

describe("parseCommandLine", () => {
  it("checks the input with the command's schema before any call, issues named by flag", async () => {
    const bad = parseCommandLine(
      notebookRun,
      ["-n", "a", "--select", "some", "--timeout-ms=-5"],
      io(),
    );
    await expect(bad).rejects.toBeInstanceOf(InvalidParams);
    const error: unknown = await bad.catch((caught: unknown) => caught);
    const paths =
      error instanceof InvalidParams ? error.data.issues.map((issue) => issue.path[0]) : [];
    expect(paths).toEqual(["--select", "--timeout-ms"]);
    await expect(
      parseCommandLine(
        cellUpdate,
        ["-n", "a", "--cell", "c_a1b2c3", "--meta", '{"lastEdit":{}}'],
        io(),
      ),
    ).rejects.toBeInstanceOf(InvalidParams);
  });
});

describe("readArgs and the input checks", () => {
  it("rethrows anything parseArgs throws that is not its TypeError", () => {
    const options = { x: { type: "string", default: 1 } } as never;
    expect(() => readArgs([], options, "x")).toThrow();
  });
});

describe("readArgs and the input checks", () => {
  it("checks a whole input and returns it as the schema reads it", () => {
    expect(checkedInput(settingsGet, {})).toEqual({});
    expect(() => {
      validate(settingsGet, { key: "nope.key" });
    }).toThrow(InvalidParams);
    expect(() => checkedInput(settingsGet, { key: 1, extra: true })).toThrow(/--key/);
  });
});

describe("a value that starts with -", () => {
  it("is refused with the remedy: --flag=-…, and for the source stdin or --file", async () => {
    const list = "- buy milk\n- call Ann";
    await expect(
      parseCommandLine(cellAdd, ["--type", "markdown", "--source", list], io()),
    ).rejects.toThrow(
      "Option '--source' argument is ambiguous. A value that starts with - is written --source=-…, or given with --source - (stdin) or --file. See nimbo cell add --help.",
    );
    await expect(parseCommandLine(cellAdd, ["-n", "-x.jsnb"], io())).rejects.toThrow(
      "Option '-n' argument is ambiguous. A value that starts with - is written --notebook=-…. See nimbo cell add --help.",
    );
    const written = await parseCommandLine(
      cellAdd,
      ["--type", "markdown", `--source=${list}`],
      io(),
    );
    expect(written.input).toMatchObject({ source: list });
  });
});
