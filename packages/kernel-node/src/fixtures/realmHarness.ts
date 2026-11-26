// An in-process realm for the root flows' tests: createRealm over a temp workspace with a fake send that collects
// the kernel's messages and wakes waiters; the flows are called directly, cells compiled with the transform first.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompiledCell } from "@jsnb/test-tools/kernel";

import type { KernelLimits, KernelMessage } from "../ipc/messages.js";
import { defaultLimits } from "../ipc/messages.js";
import { captureProcessHooks } from "../processHooks.js";
import type { Realm } from "../realm.js";
import { createRealm } from "../realm.js";
import { runCell } from "../run.js";

type ResultMessage = Extract<KernelMessage, { type: "result" }>;

type HarnessOptions = {
  /** The workspace `.env` text, written before the realm reads it. */
  readonly env?: string;
  readonly limits?: Partial<KernelLimits>;
  readonly load?: (url: string) => Promise<unknown>;
  /** The executions the interrupt hook took (none by default). */
  readonly interrupted?: (execution: string) => boolean;
};

export type Harness = {
  readonly realm: Realm;
  readonly workspace: string;
  /** Every message the kernel sent, in order. */
  readonly messages: KernelMessage[];
  /** What the kernel wrote to its log (the original stdout and stderr). */
  readonly logs: string[];
  /** Resolves with the first message, already sent or still to come, that `accept` takes. */
  readonly until: (accept: (message: KernelMessage) => boolean) => Promise<KernelMessage>;
  /** Runs a cell to its end and returns the messages it sent. */
  readonly run: (cell: CompiledCell) => Promise<readonly KernelMessage[]>;
  /** The result message of request `id`. */
  readonly result: (id: number) => ResultMessage;
  readonly writeEnv: (text: string) => void;
  readonly close: () => void;
};

/** A temp workspace with the loader the daemon writes at kernel start and the given .env. */
function prepareWorkspace(env: string | undefined): string {
  const workspace = mkdtempSync(join(tmpdir(), "nimbo-realm-"));
  if (env !== undefined) writeFileSync(join(workspace, ".env"), env);
  mkdirSync(join(workspace, ".jsnb"));
  const loader = "export const load = (specifier) => import(specifier);\n";
  writeFileSync(join(workspace, ".jsnb", "loader.mjs"), loader);
  return workspace;
}

/** Messages with waiters woken on each one. */
function collector() {
  const messages: KernelMessage[] = [];
  let waiters: (() => void)[] = [];
  const send = (message: KernelMessage): void => {
    messages.push(message);
    for (const wake of waiters.splice(0)) wake();
  };
  const until = (accept: (message: KernelMessage) => boolean): Promise<KernelMessage> =>
    new Promise((resolve) => {
      const check = (): void => {
        const found = messages.find(accept);
        if (found) resolve(found);
        else waiters.push(check);
      };
      check();
    });
  return { messages, send, until, forget: () => (waiters = []) };
}

/** The realm's exit: only a kernel that can no longer hear the daemon ends, which no in-process test makes. */
const unexpectedExit = (code: number): never => {
  throw new Error(`the realm ended the process with ${String(code)}, which no test expects`);
};

/** A realm whose stream flushes are prompt, so tests wait on messages, never on time. */
export function createHarness(options: HarnessOptions = {}): Harness {
  const workspace = prepareWorkspace(options.env);
  const { messages, send, until, forget } = collector();
  const logs: string[] = [];
  const realm = createRealm({
    config: {
      notebook: "test.jsnb",
      routeBase: "http://127.0.0.1:4321/n/test",
      limits: { ...defaultLimits(), ...options.limits },
    },
    workspace,
    processEnv: {},
    send,
    clock: () => "2026-10-12T00:00:00.000Z",
    hooks: captureProcessHooks(process),
    exit: unexpectedExit,
    interrupted: options.interrupted ?? (() => false),
    log: (_stream, text) => logs.push(text),
    load: options.load ?? ((url) => import(url)),
    schedule: (flush) => {
      queueMicrotask(flush);
    },
  });
  return {
    realm,
    workspace,
    messages,
    logs,
    until,
    writeEnv: (text) => {
      writeFileSync(join(workspace, ".env"), text);
    },
    run: async (cell) => {
      const from = messages.length;
      await runCell(realm, { type: "execute", ...cell });
      return messages.slice(from);
    },
    result: (id) => {
      const found = messages.find((message) => message.type === "result" && message.id === id);
      if (found?.type !== "result") throw new Error(`no result for request ${String(id)}`);
      return found;
    },
    close: () => {
      forget();
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

/** Compiles named cell sources once, then hands out fresh executions of them. */
export function cellBook<const Name extends string>(sources: Readonly<Record<Name, string>>) {
  const compiled = new Map<string, CompiledCell>();
  let runs = 0;
  return {
    /** Transforms every source (call it in beforeAll: the transform is not test time). */
    compile: (
      compileCell: (source: string, ids: { cell: string; execution: string }) => CompiledCell,
    ) => {
      for (const [index, [name, source]] of Object.entries<string>(sources).entries()) {
        const cell = `c_${String(index).padStart(6, "0")}`;
        compiled.set(name, compileCell(source, { cell, execution: "x_00000000" }));
      }
    },
    /** A new execution of the named cell. */
    cell: (name: Name): CompiledCell => {
      const found = compiled.get(name);
      if (!found) throw new Error(`not compiled: ${name}`);
      runs += 1;
      return { ...found, execution: `x_${String(runs).padStart(8, "0")}` };
    },
  };
}

/**
 * Pays Node's one-off costs (the Fetch implementation, the first module load through a workspace loader, the
 * first cell compile) before a file's tests, which then measure the behaviour under test (call it in beforeAll).
 */
export async function warmUp(
  compileCell: (source: string, ids: { cell: string; execution: string }) => CompiledCell,
): Promise<void> {
  await new Request("http://127.0.0.1/", { method: "POST", body: "warm" }).text();
  await new Response(new Uint8Array(1)).arrayBuffer();
  const source = [
    "import { join } from 'node:path'",
    "console.error({ path: join('a', 'b') })",
    "display.html('<b>warm</b>')",
    "display.json({ when: new Date(0) })",
    "route('GET /warm', () => 'warm')()",
    "throw Object.assign(new Error('warm'), { detail: 1, cause: new Error('cause') })",
  ].join("\n");
  const harness = createHarness({ env: "WARM=warm-value-1\n" });
  try {
    await harness.run(compileCell(source, { cell: "c_warmup", execution: "x_warmup00" }));
  } finally {
    harness.close();
  }
}
