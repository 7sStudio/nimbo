// A Node that waits at a gate before it runs (04-kernel §2), for the tests of a kernel's start: kernel.nodePath set to
// it holds the start in its Node check, before any fork, until the test opens the gate (a FIFO, fifo.ts).
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { makeFifo } from "./fifo.js";

export type GatedNode = {
  /** The script to give as kernel.nodePath: it reads the gate, then runs this process's Node with its arguments. */
  readonly path: string;
  /** Lets the run waiting at the gate go on (with `once`, every later run too); settles once it read the gate. */
  readonly open: () => Promise<void>;
};

export type GateOptions = {
  /** A shell line each run of the script runs first, before the gate (to note what it sees then). */
  readonly onCall?: string;
  /** Only the first run waits at the gate; once it was opened, later runs go straight through. */
  readonly once?: boolean;
};

/** Writes a gated Node into `folder`. */
export async function gatedNode(folder: string, options: GateOptions = {}): Promise<GatedNode> {
  const gate = join(folder, "gate");
  const [first, opened] = [join(folder, "gate-first"), join(folder, "gate-opened")];
  const path = join(folder, "gated-node");
  makeFifo(gate);
  const wait = `read -r _ < '${gate}'`;
  // mkdir is atomic: the first run waits whatever else happened; a later one waits until the gate was opened.
  const firstOrOpened = `if mkdir '${first}' 2>/dev/null; then ${wait}; else [ -e '${opened}' ] || ${wait}; fi`;
  const pass = options.once === true ? firstOrOpened : wait;
  const script = ["#!/bin/sh", options.onCall ?? "", pass, `exec '${process.execPath}' "$@"`, ""];
  await writeFile(path, script.join("\n"), { mode: 0o755 });
  const open = async (): Promise<void> => {
    if (options.once === true) await writeFile(opened, "");
    await writeFile(gate, "go\n");
  };
  return { path, open };
}
