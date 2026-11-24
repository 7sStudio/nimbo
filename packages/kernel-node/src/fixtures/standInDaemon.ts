// A process of its own standing in for the daemon (04-kernel §2), for the tests of what a kernel does once its daemon
// is gone: it starts a real NodeKernel from source over the test's workspace and runs one cell, which spawns a long
// `sleep` (it stays in the kernel's process group), says its pid on fd 1 and then "ready", and then idles or spins. The
// stand-in passes the sleep's pid on from the kernel log, then the kernel's once the cell said "ready". The test ends
// the stand-in its own way (SIGKILL, SIGINT) and waits, bounded, for both to be gone; whatever is left when the test
// ends is killed.
import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { compileCell, kernelEntry } from "@jsnb/test-tools/kernel";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { onTestFinished } from "vitest";

import { alive } from "./launchWorld.js";

/** The stand-in: a real NodeKernel in a process of its own, saying the grandchild's pid and then the kernel's. */
const script = [
  "const [nodeKernel, workspace, entry, cell] = process.argv.slice(2);",
  "const { createNodeKernel } = await import(nodeKernel);",
  "let ready = () => undefined;",
  "const said = new Promise((resolve) => (ready = resolve));",
  "const onLog = (line) => {",
  "  if (line.startsWith('grandchild ')) process.stdout.write(`${line}\\n`);",
  "  if (line === 'ready') ready();",
  "};",
  "const kernel = createNodeKernel({ workspace, notebook: 'orphan.jsnb', port: 4321, entry: JSON.parse(entry), onLog });",
  "await kernel.start();",
  "void kernel.execute(JSON.parse(cell))[Symbol.asyncIterator]().next();",
  "await said;",
  "process.stdout.write(`${kernel.pid()}\\n`);",
  "process.stdin.resume();",
].join("\n");

/** The cell the stand-in runs: a `sleep` spawned, its pid and "ready" said, then `then` (an idle end or a spin). */
const cellSource = (then: string): string =>
  [
    'import { spawn } from "node:child_process"',
    'import { writeSync } from "node:fs"',
    'const sleep = spawn("sleep", ["30"], { stdio: "ignore" })',
    "writeSync(1, `grandchild ${String(sleep.pid)}\\n`)",
    'writeSync(1, "ready\\n")',
    then,
  ].join("\n");

export type StandIn = {
  readonly daemon: ChildProcessByStdio<Writable, Readable, null>;
  /** The kernel's pid, then the pid of the sleep its cell spawned. */
  readonly pids: readonly [number, number];
};

/** Starts the stand-in over `ws`, its kernel's cell idle once it said "ready", or spinning. */
export async function startStandIn(ws: Workspace, kernel: "idle" | "spinning"): Promise<StandIn> {
  await writeFile(ws.path("daemon.mjs"), script);
  const source = cellSource(kernel === "idle" ? "1" : "while (true) {}");
  const cell = compileCell(source, { cell: "c_stand0", execution: "x_stand000" });
  const nodeKernel = new URL("../nodeKernel.ts", import.meta.url).href;
  const args = [nodeKernel, ws.dir, JSON.stringify(kernelEntry), JSON.stringify(cell)];
  const daemon = spawn(
    process.execPath,
    [...kernelEntry.execArgv, ws.path("daemon.mjs"), ...args],
    {
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const pids: number[] = [];
  onTestFinished(() => {
    daemon.kill("SIGKILL");
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
  });
  // The two lines often arrive in one chunk: the iterator keeps the second, where a second once() missed it.
  const lines = createInterface({ input: daemon.stdout })[Symbol.asyncIterator]();
  const grandchild = Number(String((await lines.next()).value).slice("grandchild ".length));
  const kernelPid = Number((await lines.next()).value);
  pids.push(kernelPid, grandchild);
  return { daemon, pids: [kernelPid, grandchild] };
}
