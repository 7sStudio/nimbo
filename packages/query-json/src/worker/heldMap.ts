// The worker's side of held values (11-query §2): a map from key to the value the worker keeps (jq keeps the JSON text,
// JSONPath the parsed value), filled by the held task that carries a value and emptied by `drop` and `release`.
import type { Result } from "../errors.ts";
import { ok } from "../errors.ts";
import type { HeldFields } from "./protocol.ts";
import { notHeld } from "./protocol.ts";

/** The value a held task runs on: the keys in `drop` forgotten first, then the task's value kept when it carries one. */
export function heldValue<T>(
  held: Map<string, T>,
  task: HeldFields,
  read: (json: string) => Result<T>,
): Result<T> {
  for (const key of task.drop ?? []) held.delete(key);
  if (task.json !== undefined) {
    const value = read(task.json);
    if (!value.ok) return value;
    held.set(task.key, value.value);
  }
  const value = held.get(task.key);
  return value === undefined ? notHeld(task.key) : ok(value);
}

/** Forgets `keys`: the answer to a release task. */
export function released(held: Map<string, unknown>, keys: readonly string[]): Result<null> {
  for (const key of keys) held.delete(key);
  return ok(null);
}
