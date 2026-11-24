// The agents' MCP config files as `mcp install` and `uninstall` edit them, on real files in a scratch folder: through a
// symbolic link, with the file's mode, layout, comments and other entries kept, and a file that does not parse left
// byte for byte as it was.
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { productName } from "@jsnb/core";
import { afterEach, describe, expect, it } from "vitest";

import { entryIn, readConfig, writeEntry } from "./agents.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nimbo-agents-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const ours = { command: "/opt/bin/nimbo", args: ["mcp"] };
const foreign = { command: "other-server", args: ["--stdio"] };
const json = (value: unknown): Record<string, unknown> =>
  JSON.parse(String(value)) as Record<string, unknown>;

describe("an agent's config file behind a symbolic link", () => {
  it("writes through a chain of links to the real file, and the links stay links", async () => {
    const dir = await scratch();
    const real = join(dir, "dotfiles", "claude_desktop_config.json");
    await mkdir(join(dir, "dotfiles"));
    await writeFile(
      real,
      `${JSON.stringify({ mcpServers: { [productName]: foreign } }, null, 2)}\n`,
    );
    await mkdir(join(dir, "app"));
    await symlink("dotfiles/claude_desktop_config.json", join(dir, "middle.json"));
    const file = join(dir, "app", "config.json");
    await symlink(join(dir, "middle.json"), file);

    expect(await writeEntry(file, "mcpServers", ours)).toBe("changed");
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect((await lstat(join(dir, "middle.json"))).isSymbolicLink()).toBe(true);
    expect(json(await readFile(real, "utf8"))).toEqual({ mcpServers: { [productName]: ours } });
    expect(await readdir(join(dir, "dotfiles"))).toEqual(["claude_desktop_config.json"]);

    expect(await writeEntry(file, "mcpServers", undefined)).toBe("changed");
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(json(await readFile(real, "utf8"))).toEqual({ mcpServers: {} });
  });

  it("creates the file a dangling link names", async () => {
    const dir = await scratch();
    const file = join(dir, "mcp.json");
    await symlink(join(dir, "store", "mcp.json"), file);
    expect(await writeEntry(file, "mcpServers", ours)).toBe("changed");
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(
      entryIn(json(await readFile(join(dir, "store", "mcp.json"), "utf8")), "mcpServers"),
    ).toEqual(ours);
  });
});

describe("the mode of a config file", () => {
  it("keeps a 0600 file 0600, and makes a new one 0600", async () => {
    const dir = await scratch();
    const file = join(dir, "claude_desktop_config.json");
    await writeFile(file, '{\n  "mcpServers": { "x": { "env": { "TOKEN": "secret" } } }\n}\n');
    await chmod(file, 0o600);
    await writeEntry(file, "mcpServers", ours);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await writeEntry(file, "mcpServers", undefined);
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    await chmod(file, 0o640);
    await writeEntry(file, "mcpServers", ours);
    expect((await stat(file)).mode & 0o777).toBe(0o640);

    const fresh = join(dir, "new", "mcp.json");
    await writeEntry(fresh, "mcpServers", ours);
    expect((await stat(fresh)).mode & 0o777).toBe(0o600);
    expect(await readFile(fresh, "utf8")).toBe(
      `${JSON.stringify({ mcpServers: { [productName]: ours } }, null, 2)}\n`,
    );
  });
});

describe("a config file that does not parse", () => {
  it("leaves a file that does not parse byte for byte as it was", async () => {
    const dir = await scratch();
    for (const text of [
      '{ "mcpServers": { "a": 1 ',
      "[1, 2]",
      '"just a string"',
      "{ mcpServers: {} }",
    ]) {
      const file = join(dir, "broken.json");
      await writeFile(file, text);
      expect(await readConfig(file)).toBeUndefined();
      expect(await writeEntry(file, "mcpServers", ours)).toBe("unparsable");
      expect(await writeEntry(file, "mcpServers", undefined)).toBe("unparsable");
      expect(await readFile(file, "utf8")).toBe(text);
    }
    expect(await readdir(dir)).toEqual(["broken.json"]);
  });
});

describe("the entries of a config file", () => {
  it("keeps the other entries and keys, and replaces its own entry rather than adding a second", async () => {
    const dir = await scratch();
    const file = join(dir, "mcp.json");
    const stale = { command: "/old/nimbo", args: ["mcp"] };
    await writeFile(
      file,
      `${JSON.stringify({ globalShortcut: "Alt+Space", mcpServers: { other: foreign, [productName]: stale } }, null, 2)}\n`,
    );
    await writeEntry(file, "mcpServers", ours);
    const text = await readFile(file, "utf8");
    expect(text.split(`"${productName}"`)).toHaveLength(2);
    expect(json(text)).toEqual({
      globalShortcut: "Alt+Space",
      mcpServers: { other: foreign, [productName]: ours },
    });

    await writeEntry(file, "mcpServers", undefined);
    expect(json(await readFile(file, "utf8"))).toEqual({
      globalShortcut: "Alt+Space",
      mcpServers: { other: foreign },
    });
    expect(await writeEntry(file, "mcpServers", undefined)).toBe("unchanged");
  });

  it("adds the server map to a file without one, and replaces a map that is not an object", async () => {
    const dir = await scratch();
    const file = join(dir, "mcp.json");
    await writeFile(file, '{\n  "theme": "dark"\n}\n');
    await writeEntry(file, "mcpServers", ours);
    expect(json(await readFile(file, "utf8"))).toEqual({
      theme: "dark",
      mcpServers: { [productName]: ours },
    });

    await writeFile(file, '{ "mcpServers": [] }');
    await writeEntry(file, "mcpServers", ours);
    expect(json(await readFile(file, "utf8"))).toEqual({ mcpServers: { [productName]: ours } });
  });
});

describe("the layout of a config file", () => {
  it("keeps the file's indentation, line ends and final newline", async () => {
    const dir = await scratch();
    const file = join(dir, "mcp.json");
    const layouts = [
      { indent: "    ", eol: "\n", end: "\n" },
      { indent: "\t", eol: "\n", end: "" },
      { indent: "  ", eol: "\r\n", end: "\r\n" },
    ];
    for (const { indent, eol, end } of layouts) {
      const original =
        JSON.stringify({ mcpServers: { other: foreign } }, null, indent).replaceAll("\n", eol) +
        end;
      await writeFile(file, original);
      await writeEntry(file, "mcpServers", ours);
      const text = await readFile(file, "utf8");
      const expected = JSON.stringify(
        { mcpServers: { other: foreign, [productName]: ours } },
        null,
        indent,
      );
      expect(text).toBe(expected.replaceAll("\n", eol) + end);

      await writeEntry(file, "mcpServers", undefined);
      expect(await readFile(file, "utf8")).toBe(original);
    }
  });
});

describe("a JSONC config file", () => {
  it("keeps the comments and trailing commas of a JSONC file, as VS Code's mcp.json has", async () => {
    const dir = await scratch();
    const file = join(dir, "mcp.json");
    const original = [
      "// my servers",
      "{",
      '  "servers": {',
      '    /* the GitHub one */ "github": { "type": "http", "url": "https://example.test/mcp" },',
      "  },",
      '  "inputs": [], // none yet',
      "}",
      "",
    ].join("\n");
    await writeFile(file, original);
    expect(entryIn((await readConfig(file)) ?? {}, "servers")).toBeUndefined();

    const entry = { type: "stdio", ...ours };
    expect(await writeEntry(file, "servers", entry)).toBe("changed");
    const text = await readFile(file, "utf8");
    for (const kept of ["// my servers", "/* the GitHub one */", "// none yet", '"inputs": [],'])
      expect(text).toContain(kept);
    expect(entryIn((await readConfig(file)) ?? {}, "servers")).toEqual(entry);

    expect(await writeEntry(file, "servers", undefined)).toBe("changed");
    const removed = await readFile(file, "utf8");
    expect(removed).not.toContain(productName);
    for (const kept of ["// my servers", "/* the GitHub one */", "// none yet"])
      expect(removed).toContain(kept);
    expect(await readConfig(file)).toEqual({
      servers: { github: { type: "http", url: "https://example.test/mcp" } },
      inputs: [],
    });
  });
});
