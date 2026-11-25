// Tests the registry against 03-api §4: every command present, names, uniqueness, tags and defaults.
import { describe, expect, it } from "vitest";

import { cellRun } from "./cell.js";
import { commandNamePattern } from "./define.js";
import { notebookRun } from "./notebook.js";
import { expected } from "./fixtures/expected.js";
import { commandByName, commandNames, commands, publicCommands } from "./registry.js";

const tagged = (
  tag: "mutating" | "destructive" | "internal" | "streaming" | "idempotent" | "planned",
) => commands.filter((c) => c.tags[tag]).map((c) => c.name);

describe("commands", () => {
  it("has every command of 03-api §4 in document order", () => {
    expect(commandNames).toEqual(expected);
    expect(new Set(commandNames).size).toBe(expected.length);
  });

  it("gives every descriptor a name, a description, schemas and tags", () => {
    for (const command of commands) {
      expect(command.name).toMatch(commandNamePattern);
      expect(command.description.length).toBeGreaterThan(10);
      expect(Object.keys(command.input.shape)).toBeDefined();
      expect(Object.keys(command.output.shape)).toBeDefined();
      expect(Object.keys(command.tags).sort()).toEqual([
        "destructive",
        "idempotent",
        "internal",
        "mutating",
        "planned",
        "streaming",
      ]);
    }
  });
});

// the tags
const debugReads = new Set(["debug.state", "debug.stack", "debug.scope", "debug.variables"]);
const debugMutations = expected.filter((n) => n.startsWith("debug.") && !debugReads.has(n));

/** The Source Control writes, in registry order (03-api §4.15). */
const gitMutations = [
  "git.stage",
  "git.unstage",
  "git.discard",
  "git.commit",
  "git.fetch",
  "git.pull",
  "git.push",
  "git.publish",
  "git.sync",
  "git.cancel",
  "git.abort",
  "git.continue",
  "git.branchCreate",
  "git.switch",
  "git.branchRename",
  "git.branchDelete",
  "git.stash",
  "git.stashApply",
  "git.stashPop",
  "git.stashDrop",
  "git.init",
];

const gitDestructive = ["git.discard", "git.abort", "git.stashDrop"];

const gitStreaming = ["git.fetch", "git.pull", "git.push", "git.publish", "git.sync"];

it("the tags mark the mutating commands as 03-api says, the debug.* that change state included", () => {
  const base = [
    "notebook.create",
    "notebook.open",
    "notebook.save",
    "notebook.reload",
    "notebook.rename",
    "notebook.run",
    "notebook.clearOutputs",
  ];
  const reviews = ["cell.revert", "cell.markReviewed"];
  const cells = [
    "cell.add",
    "cell.update",
    ...reviews,
    "cell.move",
    "cell.run",
    "kernel.interrupt",
  ];
  const packages = ["packages.add", "packages.remove", "packages.cancel"];
  const rest = [
    ...[...packages, "secrets.set", ...debugMutations, "settings.set", "settings.writeFile"],
    ...["keybindings.set", "keybindings.reset", "keybindings.writeFile"],
    "examples.copy",
    "feedback.update",
    ...gitMutations,
    "cache.clear",
    "sql.install",
    "language.rename",
  ];
  expect(tagged("mutating")).toEqual([...base, ...cells, ...rest]);
});

it("the tags mark destructive, internal, streaming, idempotent and planned commands as 03-api says", () => {
  const workspace = ["workspace.stop", "workspace.open"];
  const destructive = [...workspace, "notebook.close", "notebook.delete", "cell.delete"];
  const restarts = ["kernel.restart", "realm.restart"];
  expect(tagged("destructive")).toEqual([...destructive, ...restarts, ...gitDestructive]);
  const internal = ["realm.attach", "realm.detach", "realm.report", "events.subscribe"];
  expect(tagged("internal")).toEqual([
    ...internal,
    "settings.file",
    "settings.writeFile",
    "keybindings.rules",
    "keybindings.file",
    "keybindings.writeFile",
    "language.lsp",
    "bridge.call",
  ]);
  expect(tagged("streaming")).toEqual([
    "packages.add",
    "packages.remove",
    "events.subscribe",
    ...gitStreaming,
    "sql.install",
  ]);
  const reviews = ["cell.revert", "cell.markReviewed"];
  expect(tagged("idempotent")).toEqual([
    "notebook.open",
    "notebook.clearOutputs",
    "cell.update",
    ...reviews,
    "cell.move",
    "keybindings.set",
    "keybindings.reset",
    "feedback.update",
    "git.stage",
    "git.unstage",
    "cache.clear",
    "sql.install",
  ]);
  expect(tagged("planned")).toEqual([]);
});

describe("commandByName and publicCommands", () => {
  it("find a command and leave the internal ones out", () => {
    expect(commandByName("cell.run")).toBe(cellRun);
    expect(commandByName("cell.fly")).toBeUndefined();
    expect(publicCommands().map((c) => c.name)).toEqual(
      expected.filter((n) => !tagged("internal").includes(n)),
    );
  });
});

describe("the defaults", () => {
  it("apply when a key is omitted", () => {
    expect(cellRun.input.parse({ notebook: "demo.jsnb", cell: "c_a1b2c3" })).toEqual({
      notebook: "demo.jsnb",
      cell: "c_a1b2c3",
      wait: true,
      timeoutMs: 30_000,
      waitAutoRun: true,
    });
    expect(notebookRun.input.parse({ notebook: "d", select: "all" })).toMatchObject({
      wait: true,
      timeoutMs: 30_000,
      stopOnError: true,
    });
    const add = commandByName("cell.add")?.input.parse({ notebook: "d", type: "server" });
    expect(add).toEqual({ notebook: "d", type: "server", source: "", run: false });
    const value = commandByName("cell.outputValue")?.input.parse({
      notebook: "d",
      cell: "c_a1b2c3",
      index: 0,
    });
    expect(value).toMatchObject({ path: "$", offset: 0, limit: 2000 });
    expect(
      commandByName("settings.set")?.input.parse({ key: "ui.theme", value: "dark" }),
    ).toMatchObject({ scope: "workspace" });
    expect(commandByName("kernel.restart")?.input.parse({ notebook: "d" })).toEqual({
      notebook: "d",
      all: false,
    });
    expect(commandByName("notebook.save")?.input.parse({ notebook: "d" })).toEqual({
      notebook: "d",
      force: false,
    });
  });
});

describe("the input schemas", () => {
  it("reject what 03-api rejects", () => {
    expect(
      commandByName("cell.update")?.input.safeParse({
        notebook: "d",
        cell: "c_a1b2c3",
        meta: { lastEdit: { by: "user", client: "ui", at: "t" } },
      }).success,
    ).toBe(false);
    expect(
      commandByName("secrets.set")?.input.safeParse({ name: "lower", value: "" }).success,
    ).toBe(false);
    expect(
      commandByName("settings.set")?.input.safeParse({ key: "ui.font", value: 1 }).success,
    ).toBe(false);
    expect(commandByName("packages.add")?.input.safeParse({ names: [] }).success).toBe(false);
    expect(commandByName("packages.remove")?.input.safeParse({ names: [] }).success).toBe(false);
    expect(
      commandByName("cell.outputQuery")?.input.safeParse({
        notebook: "d",
        cell: "c_a1b2c3",
        index: 0,
        mode: "filter",
        query: [{ key: "k", op: "exists" }],
      }).success,
    ).toBe(true);
  });
});
