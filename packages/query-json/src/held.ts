// Values held in an engine's query worker under a key: kept on the main side by reference, sent to the
// worker with the first query of their key there, and again after that worker was replaced (a timeout or a crash ends
// it, and the next one starts empty). What the worker holds is bounded by `maxBytes` of JSON text (UTF-8): past it the
// oldest held values are forgotten, here and in the worker (the task that sends a value names them), and a later
// query of one fails until it is held again. A value larger than the bound alone is never held: its queries carry it.
import type { HeldBound } from "./engine.ts";
import type { Result } from "./errors.ts";
import { fail, ok } from "./errors.ts";
import type { WorkerClient } from "./worker/client.ts";
import type { TaskSource, WorkerTask } from "./worker/protocol.ts";
import { isReady, toJsonText } from "./worker/protocol.ts";

/** The default bound, the daemon's `outputs.retainMaxBytes` default: 64 MiB of JSON text. */
export const defaultHeldMaxBytes = 64 * 1024 * 1024;

type Entry = {
  readonly value: unknown;
  /** The worker generation that holds it, and its JSON text's UTF-8 length there. */
  heldBy: { readonly generation: number; readonly bytes: number } | undefined;
};

/**
 * What a held query sends: in the held task, the value's JSON text when that worker lacks it and the keys it forgets
 * first; or the value's JSON text in a task of its own, when the value is not held (released since the query was
 * asked, or larger than the bound).
 */
type HeldPayload =
  | { readonly kind: "held"; readonly json?: string; readonly drop: readonly string[] }
  | { readonly kind: "own"; readonly json: string };

export type HeldValues = {
  /** Keeps `value` under `key`: an earlier value of `key` is replaced, and the key counts as the newest. */
  readonly hold: (key: string, value: unknown) => void;
  /** Forgets `key`; true when the worker of `generation` holds it, so the engine releases it there. */
  readonly release: (key: string, generation: number) => boolean;
  /** The value under `key` as the query is asked. */
  readonly value: (key: string) => Result<unknown>;
  /** What a query of `value`, asked under `key`, sends to the worker of `generation`; marks the key held there. */
  readonly payload: (key: string, value: unknown, generation: number) => Result<HeldPayload>;
  readonly clear: () => void;
};

const unknownKey = (key: string): Result<never> =>
  fail("unavailable", `Nothing is held under ${key}. Hold the value (hold), then run the query.`);

const encoder = new TextEncoder();

/** The UTF-8 length of `text`, what the daemon's retention budget counts (native: 2 ms for 27 MB of ASCII). */
export const utf8Length = (text: string): number => encoder.encode(text).byteLength;

/** The keys to forget so that the worker of `generation`, holding `bytes` more, stays within `maxBytes`. */
function evictFor(
  entries: Map<string, Entry>,
  kept: { readonly key: string; readonly generation: number; readonly bytes: number },
  maxBytes: number,
): string[] {
  const inWorker = [...entries].filter(
    ([key, entry]) => key !== kept.key && entry.heldBy?.generation === kept.generation,
  );
  let total = inWorker.reduce((sum, [, entry]) => sum + (entry.heldBy?.bytes ?? 0), kept.bytes);
  const evicted: string[] = [];
  for (const [key, entry] of inWorker) {
    if (total <= maxBytes) break;
    total -= entry.heldBy?.bytes ?? 0;
    entries.delete(key);
    evicted.push(key);
  }
  return evicted;
}

/** The payload of an entry the worker of `generation` does not hold yet: the value, sent once, or with each query. */
function send(
  entries: Map<string, Entry>,
  held: { readonly key: string; readonly entry: Entry; readonly generation: number },
  maxBytes: number,
): Result<HeldPayload> {
  const text = toJsonText(held.entry.value);
  if (!text.ok) return text;
  const bytes = utf8Length(text.value);
  if (bytes > maxBytes) return ok({ kind: "own", json: text.value });
  held.entry.heldBy = { generation: held.generation, bytes };
  const drop = evictFor(entries, { key: held.key, generation: held.generation, bytes }, maxBytes);
  return ok({ kind: "held", json: text.value, drop });
}

/** Held values bounded by `maxBytes()` (read at each send, so a changed bound applies to the next one). */
export function createHeldValues(maxBytes: () => number): HeldValues {
  const entries = new Map<string, Entry>();
  return {
    hold: (key, value) => {
      const earlier = entries.get(key);
      const heldBy = earlier !== undefined && earlier.value === value ? earlier.heldBy : undefined;
      entries.delete(key);
      entries.set(key, { value, heldBy });
    },
    release: (key, generation) => {
      const held = entries.get(key)?.heldBy?.generation === generation;
      entries.delete(key);
      return held;
    },
    value: (key) => {
      const entry = entries.get(key);
      return entry ? ok(entry.value) : unknownKey(key);
    },
    payload: (key, value, generation) => {
      const entry = entries.get(key);
      if (entry === undefined || entry.value !== value) {
        const text = toJsonText(value);
        return text.ok ? ok({ kind: "own", json: text.value }) : text;
      }
      if (entry.heldBy?.generation === generation) return ok({ kind: "held", drop: [] });
      return send(entries, { key, entry, generation }, maxBytes());
    },
    clear: () => {
      entries.clear();
    },
  };
}

/** The bound as a function: a number stays as it is, a function is read at each send; 64 MiB by default. */
export const boundOf = (bound: HeldBound | undefined): (() => number) =>
  typeof bound === "function" ? bound : () => bound ?? defaultHeldMaxBytes;

/** How long a release may take in the worker: it deletes map entries, so this is a hang guard only. */
const releaseTimeoutMs = 5000;

type HeldQuery =
  | { readonly kind: "jq-held"; readonly program: string; readonly key: string }
  | { readonly kind: "jsonpath-held"; readonly query: string; readonly key: string };

/** The task of a query that carries its value. */
const ownTask = (query: HeldQuery, json: string): WorkerTask =>
  query.kind === "jq-held"
    ? { kind: "jq", program: query.program, json }
    : { kind: "jsonpath", query: query.query, json };

/**
 * A held query's task, built for the worker that runs it: with the value when that worker does not hold it yet, or as
 * a task of its own over `value` (what `key` held when the query was asked) when `key` was released or held again since.
 */
export const heldTask =
  (held: HeldValues, query: HeldQuery, value: unknown): TaskSource =>
  (generation) => {
    const payload = held.payload(query.key, value, generation);
    if (!payload.ok) return payload;
    if (payload.value.kind === "own") return ok(ownTask(query, payload.value.json));
    const { json, drop } = payload.value;
    return ok({ ...query, ...(json === undefined ? {} : { json }), drop });
  };

/** Forgets `key`, and releases it in the worker when that worker holds it (a stopped worker held nothing). */
export const releaseHeld = (held: HeldValues, client: WorkerClient, key: string): void => {
  if (!held.release(key, client.generation())) return;
  const task = { kind: "release", keys: [key] } as const;
  void client.run(task, isReady, { timeoutMs: releaseTimeoutMs, onlyIfRunning: true }); // never rejects
};
