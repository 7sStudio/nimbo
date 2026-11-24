// Worker side of the jq engine: runs one program over one value and turns every failure into a QueryError.
import type { Jq } from "jq-wasm/inline";

import type { TransformResult } from "../engine.ts";
import type { Result } from "../errors.ts";
import { fail, messageOf, ok } from "../errors.ts";
import { jqErrorOf } from "./errors.ts";

type JqFailure = Error & { readonly stderr: string };

/** jq-wasm's JqError, recognised by shape: its class is not imported here so jq loads only on first use. */
const isJqFailure = (cause: unknown): cause is JqFailure =>
  cause instanceof Error &&
  cause.name === "JqError" &&
  "stderr" in cause &&
  typeof cause.stderr === "string";

/**
 * A WebAssembly trap leaves the jq instance unusable: an Emscripten abort ("Aborted()") when the 256 MB heap runs out,
 * an out-of-bounds access when jq's own stack overflows (printing a value nested a few thousand levels deep). Kind
 * "memory" makes the worker drop the instance and the client replace the worker.
 */
const trapMessage = (trap: string): string =>
  trap.startsWith("Aborted(")
    ? "The jq program ran out of memory (jq's WebAssembly heap is capped at 256 MB, and jq reads its whole input at every run, so a value of a few tens of MB can exceed it). Narrow the input or the program, or query a large value with JSONPath or SQL."
    : `jq failed inside its WebAssembly runtime (${trap}), most often on a value nested too deeply for it. Narrow the input or the program and run it again.`;

const failureOf = (cause: unknown, program: string): Result<never> => {
  if (isJqFailure(cause)) {
    return { ok: false, error: jqErrorOf(cause.stderr || cause.message, program) };
  }
  if (cause instanceof WebAssembly.RuntimeError) return fail("memory", trapMessage(cause.message));
  return fail(
    "runtime",
    `The jq program failed (${messageOf(cause)}). Run it again; if it fails the same way, reload the page or restart the daemon.`,
  );
};

/** Runs `program` over the value `json` holds; the value is the only output when there is one, else all outputs. */
export const runJq = (jq: Jq, program: string, json: string): Result<TransformResult> => {
  try {
    const outputs = jq.json(json, program);
    return ok(
      outputs.length === 1
        ? { value: outputs[0], count: 1 }
        : { value: outputs, count: outputs.length },
    );
  } catch (cause) {
    return failureOf(cause, program);
  }
};
