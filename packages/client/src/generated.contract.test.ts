// The generated client's contract (08-code-standards §2, 09-testing §4.1): the committed file is exactly what the
// generator renders from the registry, and it has one method per command not tagged internal, calling that command.
import { readFile } from "node:fs/promises";

import type { AnyCommand } from "@jsnb/core";
import { commands, defineCommand, JsnbError, publicCommands } from "@jsnb/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { generatedPath, generatedSource, namedCommands } from "../scripts/generate.js";
import { renderClient } from "../scripts/render.js";
import type { Caller } from "./call/caller.js";
import { bindCommands } from "./generated.js";

/** A Caller that records which descriptor each method called, with which input. */
const recordingCaller = () => {
  const calls: { readonly command: AnyCommand; readonly input: unknown }[] = [];
  const call: Caller = (command, input) => {
    calls.push({ command, input });
    return Promise.resolve({} as never);
  };
  return { call, calls };
};

type AnyMethod = (input: unknown) => Promise<unknown>;

const methodsOf = (client: ReturnType<typeof bindCommands>) =>
  Object.entries(client).flatMap(([domain, methods]) =>
    Object.entries(methods as Record<string, AnyMethod>).map(([verb, method]) => ({
      name: `${domain}.${verb}`,
      method,
    })),
  );

describe("generated.ts", () => {
  it("is byte for byte what the generator renders from the registry", async () => {
    const committed = await readFile(generatedPath, "utf8");
    expect(committed).toBe(await generatedSource());
  });

  it("has a method for every command not tagged internal, and none for the internal ones", () => {
    const names = methodsOf(bindCommands(recordingCaller().call)).map((entry) => entry.name);
    expect(names).toEqual(publicCommands().map((command) => command.name));
    const internal = commands
      .filter((command) => command.tags.internal)
      .map((command) => command.name);
    for (const name of internal) expect(names).not.toContain(name);
  });

  it("calls each method's own descriptor with the input it was given", async () => {
    const { call, calls } = recordingCaller();
    const methods = methodsOf(bindCommands(call));
    for (const { method } of methods) await method({ notebook: "demo.jsnb" });
    expect(calls.map((entry) => entry.command.name)).toEqual(methods.map((entry) => entry.name));
    expect(
      calls.every((entry) => (entry.input as { notebook: string }).notebook === "demo.jsnb"),
    ).toBe(true);
  });

  it("lets the input be left out where no key is required", async () => {
    const { call, calls } = recordingCaller();
    const client = bindCommands(call);
    await client.workspace.info();
    await client.settings.get();
    expect(calls.map((entry) => entry.input)).toEqual([{}, {}]);
  });
});

describe("the generator", () => {
  const command = (name: string, description = "Does it.") =>
    defineCommand({ name, description, input: z.object({ id: z.string() }), output: z.object({}) });

  it("names every registry command by its export", () => {
    expect(namedCommands().map((entry) => entry.command)).toEqual(commands);
    expect(
      namedCommands().find((entry) => entry.command.name === "settings.schema")?.exportName,
    ).toBe("settingsSchemaCommand");
  });

  it("refuses a domain that would shadow a client member", () => {
    const render = () => renderClient([{ exportName: "closeAll", command: command("close.all") }]);
    expect(render).toThrow(JsnbError);
    expect(render).toThrow(/close\.all/);
  });

  it("keeps a description from closing its JSDoc early", () => {
    const source = renderClient([{ exportName: "fooBar", command: command("foo.bar", "a */ b") }]);
    expect(source).toContain("/** a *\\/ b */");
    expect(source).toContain("bar: bind(call, fooBar),");
  });
});
