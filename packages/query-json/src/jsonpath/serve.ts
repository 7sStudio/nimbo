// The JSONPath worker's side: answers each jsonpath task with the evaluator over the value its JSON text holds, and
// each jsonpath-held task over the value held under its key (parsed once, from the task that carries it), and
// releases held keys. It never loads jq, so the JSONPath worker bundle holds the JSONPath library alone.
import type { Result } from "../errors.ts";
import { fail } from "../errors.ts";
import { heldValue, released } from "../worker/heldMap.ts";
import type { Serve } from "../worker/protocol.ts";
import { fromJsonText, isWorkerTask } from "../worker/protocol.ts";
import { selectPaths } from "./evaluate.ts";

const refused = (): Result<never> =>
  fail(
    "unavailable",
    "The JSONPath worker received a task it does not run. Reload the page or restart the daemon.",
  );

const answer = (task: unknown, held: Map<string, unknown>): Result<unknown> => {
  if (!isWorkerTask(task)) return refused();
  if (task.kind === "release") return released(held, task.keys);
  if (task.kind !== "jsonpath" && task.kind !== "jsonpath-held") return refused();
  const value =
    task.kind === "jsonpath" ? fromJsonText(task.json) : heldValue(held, task, fromJsonText);
  return value.ok ? selectPaths(value.value, task.query) : value;
};

/** A JSONPath server with its held values, one per worker. */
export const createJsonPathServer = (): Serve => {
  const held = new Map<string, unknown>();
  return (task) => Promise.resolve(answer(task, held));
};
