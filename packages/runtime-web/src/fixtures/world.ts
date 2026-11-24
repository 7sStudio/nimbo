// A test's own world (09-testing §1.6): a fresh transport, a mount root, an attached Realm, and a daemon-like `run`.
import type { Output, RealmReport, SnapshotBinding } from "@jsnb/core";
import { decode } from "@jsnb/core";

import type { RealmOptions } from "../realm/options.js";
import { Realm } from "../realm/realm.js";
import { transformCell } from "./transform.js";
import type { BridgeHandler, TestTransport } from "./transport.js";
import { createTestTransport } from "./transport.js";

type RunRequest = {
  readonly cell?: string;
  readonly bindings?: Readonly<Record<string, SnapshotBinding>>;
  readonly env?: Readonly<Record<string, string>>;
};

export type RunResult = {
  readonly cell: string;
  readonly execution: string;
  readonly outputs: Output[];
  readonly status: RealmReport;
};

export type World = {
  readonly realm: Realm;
  readonly transport: TestTransport;
  readonly root: HTMLElement;
  /** Errors the realm could not report (`onError`). */
  readonly errors: unknown[];
  /** Transforms and runs `source` as the daemon would; resolves once realm.execute answered. */
  readonly run: (source: string, request?: RunRequest) => Promise<RunResult>;
  readonly dispose: () => Promise<void>;
};

let executions = 0;
let cells = 0;

/** Stable ids per test file (03-api §2 shapes): `x_` and eight base36 characters, `c_` and six. */
export const nextExecution = (): string => `x_${(executions += 1).toString(36).padStart(8, "0")}`;
export const nextCell = (): string => `c_${(cells += 1).toString(36).padStart(6, "0")}`;

const filenameOf = (cell: string): string => `jsnb:///test.jsnb/${cell}.ts`;

export type WorldOptions = Partial<Omit<RealmOptions, "transport">> & {
  readonly bridge?: BridgeHandler;
  readonly failReport?: (report: RealmReport) => Error | undefined;
};

export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const transport = createTestTransport(options);
  const root = document.createElement("section");
  document.body.append(root);
  const errors: unknown[] = [];
  const realm = new Realm({
    notebook: "test.jsnb",
    mount: (_cell, container) => {
      root.append(container);
    },
    onError: (error) => {
      errors.push(error);
    },
    ...options,
    transport,
  });
  await realm.attach();
  const run = async (source: string, request: RunRequest = {}): Promise<RunResult> => {
    const cell = request.cell ?? nextCell();
    const execution = nextExecution();
    const compiled = await transformCell(source, filenameOf(cell));
    if (!compiled.ok) throw new Error(`${compiled.name}: ${compiled.message}`);
    const { code, map } = compiled;
    const env = request.env === undefined ? {} : { env: request.env };
    const params = { execution, cell, code, map, bindings: request.bindings ?? {}, ...env };
    await realm.handle("realm.execute", params);
    const status = await transport.until(
      (r) => r.execution === execution && r.status !== undefined,
    );
    return { cell, execution, outputs: transport.outputsOf(execution), status };
  };
  const dispose = async (): Promise<void> => {
    await realm.detach();
    root.remove();
  };
  return { realm, transport, root, errors, run, dispose };
}

/** The decoded `value` output of a run, or undefined when it showed none. */
export function valueOf(result: RunResult): unknown {
  const output = result.outputs.find((candidate) => candidate.kind === "value");
  return output?.kind === "value" ? decode(output.json) : undefined;
}

/** The text a run wrote to one stream, in order. */
export function textOf(outputs: readonly Output[], stream: "stdout" | "stderr" = "stdout"): string {
  return outputs
    .map((output) => (output.kind === "stream" && output.stream === stream ? output.text : ""))
    .join("");
}

/** A compiled cell written by hand, for runs that need no transform (`__scope` is the scope view). */
export const compiled = (body: string, cell: string): { code: string; map: string } => {
  const file = filenameOf(cell);
  const code = `(async (__scope) => {\n"use strict";\n${body}\n});\n//# sourceURL=${file}\n`;
  return {
    code,
    map: JSON.stringify({ version: 3, file, sources: [file], names: [], mappings: "" }),
  };
};
