// The messages between the engines and the query worker, the channel that carries them, and the checks applied to
// whatever arrives from the other side (a worker boundary is a trust boundary: nothing is cast).
import type { SelectResult, TransformResult } from "../engine.ts";
import type { QueryError, Result } from "../errors.ts";
import { fail, messageOf, ok } from "../errors.ts";

/** Each engine has its own worker, whose bundle holds that engine alone. */
export type WorkerKind = "jq" | "jsonpath";

/**
 * One unit of work for the worker. The value travels as its JSON text: JSON.stringify and JSON.parse work at any
 * depth (structured clone overflows its stack beyond a few thousand levels) and together cost less than a clone. A held
 * value travels once: its task carries `json` only when the worker does not hold `key` yet, and the
 * worker keeps it under `key` for the queries after, having first forgotten the keys in `drop` (the oldest, past the
 * bound); `release` forgets keys.
 */
export type WorkerTask =
  | { readonly kind: "warm-jq" }
  | { readonly kind: "jq"; readonly program: string; readonly json: string }
  | { readonly kind: "jsonpath"; readonly query: string; readonly json: string }
  | ({ readonly kind: "jq-held"; readonly program: string } & HeldFields)
  | ({ readonly kind: "jsonpath-held"; readonly query: string } & HeldFields)
  | { readonly kind: "release"; readonly keys: readonly string[] };

/** What a held task carries besides its query: the key, the value when it is sent, the keys to forget first. */
export type HeldFields = {
  readonly key: string;
  readonly json?: string;
  readonly drop?: readonly string[];
};

/**
 * A task, or how to build it for the worker that will run it (its generation, which counts the workers started): a
 * held value's task carries the value only for a worker that does not hold it yet.
 */
export type TaskSource = WorkerTask | ((generation: number) => Result<WorkerTask>);

/** What the worker posts back for a task: the task's Result. */
type WorkerReply = Result<unknown>;

/** The worker side: answers one message with its reply; never rejects. */
export type Serve = (task: unknown) => Promise<WorkerReply>;

/** The main side's handle on a running worker. `post` throws when the task cannot be cloned. */
export type WorkerChannel = {
  post(task: WorkerTask): void;
  terminate(): Promise<void>;
};

/** What a spawned worker reports: every message it posts, and its death (crash, heap cap, exit). */
export type WorkerEvents = {
  readonly onReply: (reply: unknown) => void;
  readonly onFailure: (error: QueryError) => void;
};

/** Starts one engine's worker; spawn.ts has the real one, tests pass one over a MessageChannel. */
export type SpawnWorker = (
  kind: WorkerKind,
  memoryMb: number,
  events: WorkerEvents,
) => WorkerChannel;

type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null;

const isKeys = (value: unknown): boolean =>
  Array.isArray(value) && value.every((key) => typeof key === "string");

/** Whether a held task's fields are well formed: a key, JSON text when it carries the value, keys to forget. */
const isHeldTask = (value: Fields): boolean =>
  typeof value.key === "string" &&
  (value.json === undefined || typeof value.json === "string") &&
  (value.drop === undefined || isKeys(value.drop));

/** The check of each task kind's fields. */
const taskChecks: Readonly<Record<WorkerTask["kind"], (value: Fields) => boolean>> = {
  "warm-jq": () => true,
  jq: (value) => typeof value.program === "string" && typeof value.json === "string",
  jsonpath: (value) => typeof value.query === "string" && typeof value.json === "string",
  "jq-held": (value) => typeof value.program === "string" && isHeldTask(value),
  "jsonpath-held": (value) => typeof value.query === "string" && isHeldTask(value),
  release: (value) => isKeys(value.keys),
};

const isTaskKind = (kind: unknown): kind is WorkerTask["kind"] =>
  typeof kind === "string" && Object.hasOwn(taskChecks, kind);

/** Whether a message received by the worker is a task it knows. */
export const isWorkerTask = (value: unknown): value is WorkerTask =>
  isFields(value) && isTaskKind(value.kind) && taskChecks[value.kind](value);

/** The worker's answer to a held task whose key it does not hold: the main side sends the value again. */
export const notHeld = (key: string): Result<never> =>
  fail(
    "unavailable",
    `The query worker does not hold ${key}. Hold the value again, then run the query.`,
  );

/** JSON.stringify as the spec types it: undefined for undefined, functions and symbols. */
const stringify = (value: unknown): string | undefined => JSON.stringify(value);

/** The JSON text a task carries for a value (`null` for undefined); BigInt and cycles cannot be sent. */
export const toJsonText = (value: unknown): Result<string> => {
  try {
    return ok(stringify(value) ?? "null");
  } catch (cause) {
    return fail(
      "runtime",
      `The value cannot be sent to the query worker as JSON (${messageOf(cause)}). Only JSON values can be queried: no BigInt, no cycles.`,
    );
  }
};

/** The value a task's JSON text holds, read on the worker side. */
export const fromJsonText = (text: string): Result<unknown> => {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch (cause) {
    return fail(
      "unavailable",
      `The query worker could not read the value it was sent (${messageOf(cause)}). Reload the page or restart the daemon.`,
    );
  }
};

const errorKinds: ReadonlySet<unknown> = new Set([
  "syntax",
  "runtime",
  "timeout",
  "memory",
  "aborted",
  "unavailable",
]);

const isQueryError = (value: unknown): value is QueryError =>
  isFields(value) &&
  errorKinds.has(value.kind) &&
  typeof value.message === "string" &&
  (value.position === undefined || typeof value.position === "number");

/** A select reply's value. */
export const isSelectResult = (value: unknown): value is SelectResult =>
  isFields(value) &&
  Array.isArray(value.paths) &&
  value.paths.every((path) => typeof path === "string");

/** A transform reply's value. */
export const isTransformResult = (value: unknown): value is TransformResult =>
  isFields(value) && "value" in value && typeof value.count === "number";

/** The reply to "warm-jq". */
export const isReady = (value: unknown): value is null => value === null;

/** Whether a reply says the worker's state is lost (a jq abort) and the worker must be replaced. */
export const isFatalReply = (reply: unknown): boolean =>
  isFields(reply) && reply.ok === false && isFields(reply.error) && reply.error.kind === "memory";

/** A reply as a typed Result, or an `unavailable` error when it is not one this version can read. */
export const readReply = <T>(reply: unknown, accept: (value: unknown) => value is T): Result<T> => {
  if (isFields(reply) && reply.ok === true && accept(reply.value)) return ok(reply.value);
  if (isFields(reply) && reply.ok === false && isQueryError(reply.error))
    return { ok: false, error: reply.error };
  return fail(
    "unavailable",
    "The query worker sent a reply this version cannot read. Reload the page or restart the daemon.",
  );
};
