// Tests an interrupt in each async context through the real child (04-kernel §6). In a context Node entered from
// JavaScript (a raw setImmediate, setTimeout or process.nextTick callback, a cell spinning inside runInAsyncScope, a raw
// queueMicrotask callback, a cell spinning under promise hooks) the hook terminates nothing and interrupt() rejects
// InterruptRefused naming the context and the cell; the kernel lives, the code returns once the test writes a flag
// file, the next run answers, and once a second inspector client turned async stack traces on (as Chrome DevTools
// and VS Code do on attach) one more run answers: no stale entry was left on Node's async stack. In a clean context (a
// cell, an fs callback, a net data listener, AsyncLocalStorage.run) the code stops, the kernel lives, and with async
// stack traces on afterwards a run answers.
import { writeFile } from "node:fs/promises";

import type { InterruptContext, KernelEvent } from "@jsnb/core";
import { decode } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import type { KernelWorld } from "./fixtures/kernelWorld.js";
import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";
import { connectCdp } from "./ipc/inspector.js";
import type { NodeKernel } from "./ipc/nodeKernel.js";

const writes = 'import { existsSync, writeSync } from "node:fs"';

/** Says on fd 1 (the kernel log) that it spins, spins until release.flag exists, then says it was released. */
const gated =
  'writeSync(1, "spinning\\n"); while (!existsSync("release.flag")) {} writeSync(1, "released\\n")';

/** Says on fd 1 that it spins, then spins. */
const spins = 'writeSync(1, "spinning\\n"); while (true) {}';

const listener = [
  'import { connect, createServer } from "node:net"',
  `const server = createServer((socket) => socket.on("data", () => { ${spins} }))`,
  'server.listen(0, "127.0.0.1", () => {',
  "  const { port } = server.address() as { port: number }",
  '  const client = connect(port, "127.0.0.1", () => client.write("x"))',
  "})",
];

const book = cellBook({
  immediate: `${writes}\nglobalThis.setImmediate(() => { ${gated} })`,
  timeout: `${writes}\nglobalThis.setTimeout(() => { ${gated} }, 0)`, // tested behaviour: a raw timer
  nextTick: `${writes}\nprocess.nextTick(() => { ${gated} })`,
  scope: `${writes}\nimport { AsyncResource } from "node:async_hooks"\nnew AsyncResource("X").runInAsyncScope(() => { ${gated} })`,
  microtask: `${writes}\nglobalThis.queueMicrotask(() => { ${gated} })`,
  hooks:
    'import { createHook } from "node:async_hooks"\ncreateHook({ before() {}, after() {} }).enable()\n1',
  hooked: `${writes}\n${gated}`,
  cell: `${writes}\n${spins}`,
  fsCallback: `${writes}\nimport { readFile } from "node:fs"\nreadFile("missing.txt", () => { ${spins} })`,
  netListener: [writes, ...listener].join("\n"),
  storeRun: `${writes}\nimport { AsyncLocalStorage } from "node:async_hooks"\nnew AsyncLocalStorage().run(1, () => { ${spins} })`,
  sum: "1 + 1",
});

type CellName = Parameters<typeof book.cell>[0];

beforeAll(() => {
  book.compile(compileCell);
});

/** The decoded value of a run that ended ok. */
function valueOf(events: readonly KernelEvent[]): unknown {
  expect(events.at(-1)).toMatchObject({ status: "ok" });
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  return found?.kind === "output" && found.output.kind === "value"
    ? decode(found.output.json)
    : undefined;
}

/** Every event of an execution, once it ended. */
async function drain(events: AsyncIterable<KernelEvent>): Promise<readonly KernelEvent[]> {
  const all: KernelEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

/** Runs `fn` while a second inspector client has async stack traces on, as Chrome DevTools and VS Code turn them on. */
async function withAsyncStacks(kernel: NodeKernel, fn: () => Promise<void>): Promise<void> {
  const client = await connectCdp(kernel.inspectorUrl() ?? "", {
    onPause: () => undefined,
    onInvalid: () => undefined,
  });
  try {
    await client.send("Debugger.enable");
    await client.send("Debugger.setAsyncCallStackDepth", { maxDepth: 32 });
    await fn();
  } finally {
    client.close();
  }
}

/**
 * Starts `name` and resolves once its code spins. A cell whose run is still live then (it spins itself, or a microtask
 * of its own runs before its run ends) has its events collected until the run ended (`ended`); any other ran to `ok`
 * first and left a callback that spins.
 */
async function spinning(world: KernelWorld, name: CellName, live: boolean) {
  const ended = live ? drain(world.kernel.execute(book.cell(name))) : undefined;
  if (!live) expect((await world.run(book.cell(name))).at(-1)).toMatchObject({ status: "ok" });
  await world.until(({ logs }) => logs.includes("spinning"));
  return { ended };
}

/** The kernel answers a run, and another one with async stack traces on; it never exited. */
async function answers({ kernel, run, seen }: KernelWorld): Promise<void> {
  expect(valueOf(await run(book.cell("sum")))).toBe(2);
  await withAsyncStacks(kernel, async () => {
    expect(valueOf(await run(book.cell("sum")))).toBe(2);
  });
  expect(seen.exits).toEqual([]);
}

const refused: readonly (readonly [CellName, InterruptContext, boolean])[] = [
  ["immediate", "Immediate", false],
  ["timeout", "Timeout", false],
  ["nextTick", "TickObject", false],
  ["scope", "AsyncResource", true],
  ["microtask", "AsyncResource", true],
  ["hooked", "Promise", true],
];

describe("an interrupt in a context Node entered from JavaScript", () => {
  for (const [name, context, live] of refused) {
    it(`refuses to stop ${name} code with InterruptRefused { ${context} }, and the kernel lives`, async () => {
      await withKernel(async (world) => {
        if (name === "hooked") await world.run(book.cell("hooks"));
        const { ended } = await spinning(world, name, live);
        const cell = book.cell(name).cell;
        await expect(world.kernel.interrupt()).rejects.toMatchObject({
          name: "InterruptRefused",
          code: 1010,
          data: { context, cell },
        });
        if (ended) expect((await ended).at(-1)).toMatchObject({ status: "interrupted" });
        await writeFile(world.ws.path("release.flag"), "");
        await world.until(({ logs }) => logs.includes("released"));
        await answers(world);
      });
    });
  }
});

const stopped: readonly (readonly [CellName, boolean])[] = [
  ["cell", true],
  ["fsCallback", false],
  ["netListener", false],
  ["storeRun", true],
];

describe("an interrupt in a clean context", () => {
  for (const [name, live] of stopped) {
    it(`stops ${name} code, and the kernel lives with async stack traces on`, async () => {
      await withKernel(async (world) => {
        const { ended } = await spinning(world, name, live);
        await world.kernel.interrupt();
        if (ended) expect((await ended).at(-1)).toMatchObject({ status: "interrupted" });
        await answers(world);
      });
    });
  }
});
