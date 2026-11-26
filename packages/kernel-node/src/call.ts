// A bridge `call`: the export's function, the decoded argument array, the call under the defining
// cell's store (its logs land there), the process hooks checked, the result in strict wire form with
// the redaction flag; a throw fails the call and is also an error output on the defining cell.
import { decode, encodeStrict, InvalidParams, ResultNotSerializable } from "@jsnb/core";

import { callUserCode } from "./builtins/userCode.js";
import type { CallMessage } from "./ipc/messages.js";
import type { Realm } from "./realm.js";
import type { ResultFields } from "./result.js";
import { reply, settle } from "./result.js";
import type { Store } from "./store.js";

type Callable = (...args: unknown[]) => unknown;

const isCallable = (value: unknown): value is Callable => typeof value === "function";

/** The store a call to `cell`'s export runs under: the cell's latest execution. */
function storeOf(realm: Realm, cell: string): Store | undefined {
  const execution = realm.lastExecution.get(cell);
  return execution === undefined ? undefined : { cell, execution };
}

/** The result's wire form, `redacted` true when redaction changed any string; bytes cross whole up to
 * `limit`, the request's or the launch one. */
function encodeResult(realm: Realm, fn: string, value: unknown, limit: number): ResultFields {
  let redacted = false;
  const redact = (text: string): string => {
    const out = realm.environment.redact(text);
    if (out !== text) redacted = true;
    return out;
  };
  const encoded = encodeStrict(value, { maxBytesPerValue: limit, redact });
  if (encoded.ok) return { value: encoded.json, redacted };
  const { type, bytes } = encoded.error;
  const sized = bytes === undefined ? {} : { bytes, limit };
  const failure = new ResultNotSerializable({ name: fn, type, ...sized });
  return { error: realm.errorInfo(failure) };
}

/** The argument array of a call, or undefined when an element of its wire form is malformed. */
function argumentsOf(args: readonly unknown[]): readonly unknown[] | undefined {
  try {
    const decoded = decode(args);
    return Array.isArray(decoded) ? decoded : undefined;
  } catch {
    // A malformed marker (a bigint that is not a number) is bad arguments, answered as InvalidParams.
    return undefined;
  }
}

/** The result of one `call`: the function's value in strict wire form, or the error it threw or that refused it. A call
 * refused before anything ran says why (`refused`), so the daemon can answer in the catalogue's words. */
async function callResult(realm: Realm, message: CallMessage): Promise<ResultFields> {
  const target = realm.exports.resolve(message.fn);
  if (!target) {
    const error = realm.errorInfo(new ReferenceError(`${message.fn} is not a current export`));
    return { error, refused: "missing" };
  }
  const fn = realm.scope.peek(target.local);
  if (!isCallable(fn))
    return {
      error: realm.errorInfo(new TypeError(`${message.fn} is not a function`)),
      refused: "value",
    };
  const args = argumentsOf(message.args);
  if (!args) {
    const issue = { path: ["args"], message: "must be the wire form of the argument array" };
    return { error: realm.errorInfo(new InvalidParams({ issues: [issue] })) };
  }
  const store = storeOf(realm, target.cell);
  const outcome = await settle(() =>
    realm.stores.run(store, () => callUserCode(fn, undefined, args)),
  );
  const checked = realm.checkHooks(store);
  if (checked) await checked;
  const limit = message.maxBytesPerValue ?? realm.config.limits.maxBytesPerValue;
  if (outcome.ok) return encodeResult(realm, message.fn, outcome.value, limit);
  realm.reportError(store, outcome.error);
  return { error: realm.errorInfo(outcome.error) };
}

/** Answers one `call` message with exactly one `result`, whatever its flow throws. */
export async function callFlow(realm: Realm, message: CallMessage): Promise<void> {
  let fields: ResultFields;
  try {
    fields = await callResult(realm, message);
  } catch (error) {
    // A step of the kernel's own failed (a result whose getter throws while it is encoded): answer with that error.
    fields = { error: realm.errorInfo(error) };
  }
  reply(realm.send, message.id, fields);
}
