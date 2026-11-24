// The jq worker's side: loads jq's WebAssembly on the first task, answers warm-jq, jq and jq-held tasks (a held value's
// JSON text kept under its key from the task that carries it, before jq loads, so a failed load loses no value),
// releases held keys, and drops its jq instance after an abort. It imports nothing of JSONPath, so the jq worker bundle
// holds jq alone.
import type { Jq } from "jq-wasm/inline";

import type { Result } from "../errors.ts";
import { fail, messageOf, ok } from "../errors.ts";
import { heldValue, released } from "../worker/heldMap.ts";
import type { Serve, WorkerTask } from "../worker/protocol.ts";
import { isWorkerTask } from "../worker/protocol.ts";
import { runJq } from "./run.ts";

const loadJq = async (): Promise<Result<Jq>> => {
  try {
    const { loadJq: load } = await import("jq-wasm/inline");
    return ok(await load());
  } catch (cause) {
    return fail(
      "unavailable",
      `jq could not start: ${messageOf(cause)}. Reload the page or restart the daemon.`,
    );
  }
};

const refused = (): Result<never> =>
  fail(
    "unavailable",
    "The jq worker received a task it does not run. Reload the page or restart the daemon.",
  );

type JqTask = Extract<WorkerTask, { kind: "warm-jq" | "jq" | "jq-held" }>;

/** The jq tasks: everything but JSONPath's and release. */
const isJqTask = (task: WorkerTask): task is JqTask =>
  task.kind === "warm-jq" || task.kind === "jq" || task.kind === "jq-held";

/** The JSON text a jq task runs on: its own, or the held one. */
const textOf = (
  task: Exclude<JqTask, { kind: "warm-jq" }>,
  held: Map<string, string>,
): Result<string> => (task.kind === "jq" ? ok(task.json) : heldValue(held, task, ok));

/** A jq server with its own jq instance, loaded on first use and dropped after an abort, and its held values. */
export const createJqServer = (): Serve => {
  let jq: Promise<Result<Jq>> | undefined;
  const held = new Map<string, string>();
  const instance = async (): Promise<Result<Jq>> => {
    jq ??= loadJq();
    const loaded = await jq;
    if (!loaded.ok) jq = undefined;
    return loaded;
  };
  return async (task) => {
    if (!isWorkerTask(task)) return refused();
    if (task.kind === "release") return released(held, task.keys);
    if (!isJqTask(task)) return refused();
    const text = task.kind === "warm-jq" ? ok("") : textOf(task, held);
    if (!text.ok) return text;
    const loaded = await instance();
    if (!loaded.ok) return loaded;
    if (task.kind === "warm-jq") return ok(null);
    const reply = runJq(loaded.value, task.program, text.value);
    if (!reply.ok && reply.error.kind === "memory") jq = undefined;
    return reply;
  };
};
