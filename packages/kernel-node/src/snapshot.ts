// A bridge `snapshot` (05-bridge §3): per exported name, fn for a function, an error for a class, the strict wire
// form of plain data, or NotTransferable naming the path of the first value that cannot cross.
import type { SnapshotBinding } from "@jsnb/core";
import { encodeStrict, NotTransferable, unescapeKey } from "@jsnb/core";

import type { SnapshotMessage } from "./ipc/messages.js";
import type { Realm } from "./realm.js";
import type { ResultFields } from "./result.js";
import { reply } from "./result.js";

const identifier = /^[A-Za-z_$][\w$]*$/;

/** Captured when the module loads: a cell that replaces JSON.stringify breaks its own code only (§3.3). */
const stringify = JSON.stringify.bind(JSON);

/** `prices` + [1] → `prices[1]`; `config` + ["client"] → `config.client` (05-bridge §7 names the value). */
export function pathName(name: string, path: readonly (string | number)[]): string {
  return path.reduce<string>((text, segment) => {
    if (typeof segment === "number") return `${text}[${String(segment)}]`;
    const key = unescapeKey(segment);
    return identifier.test(key) ? `${text}.${key}` : `${text}[${stringify(key)}]`;
  }, name);
}

/** A class is a function whose source starts with `class` (05-bridge §2: refused, not shipped). */
const isClass = (value: object): boolean =>
  Function.prototype.toString.call(value).startsWith("class");

function bindingOf(
  realm: Realm,
  name: string,
  value: unknown,
  maxBytesPerValue: number,
): SnapshotBinding {
  if (typeof value === "function") {
    if (!isClass(value)) return { kind: "fn" };
    return { kind: "error", error: realm.errorInfo(new NotTransferable({ name, type: "class" })) };
  }
  const encoded = encodeStrict(value, { maxBytesPerValue, redact: realm.environment.redact });
  if (encoded.ok) return { kind: "value", json: encoded.json };
  const { path, type, bytes } = encoded.error;
  const sized = bytes === undefined ? {} : { bytes, limit: maxBytesPerValue };
  const failure = new NotTransferable({ name: pathName(name, path), type, ...sized });
  return { kind: "error", error: realm.errorInfo(failure) };
}

/** The binding of `name`, or its error when reading or encoding its value throws (a getter): the others still answer. */
function guardedBinding(realm: Realm, name: string, local: string, limit: number): SnapshotBinding {
  try {
    return bindingOf(realm, name, realm.scope.peek(local), limit);
  } catch (error) {
    // The value fought back while it was read or encoded: this name carries the error.
    return { kind: "error", error: realm.errorInfo(error) };
  }
}

/** The bindings of one `snapshot` message; a name that is not a current export fails the whole request. */
function snapshotFields(realm: Realm, message: SnapshotMessage): ResultFields {
  const bindings: Record<string, SnapshotBinding> = {};
  const limit = message.maxBytesPerValue ?? realm.config.limits.maxBytesPerValue;
  for (const name of message.names) {
    const target = realm.exports.resolve(name);
    if (!target) {
      return { error: realm.errorInfo(new ReferenceError(`${name} is not a current export`)) };
    }
    bindings[name] = guardedBinding(realm, name, target.local, limit);
  }
  return { value: bindings };
}

/**
 * Answers one `snapshot` message. Reading the values can run user code (a getter), so the process hooks are checked
 * before the answer leaves (04-kernel §3.3); no cell's code was started, so none gets the error output.
 */
export async function snapshotFlow(realm: Realm, message: SnapshotMessage): Promise<void> {
  const fields = snapshotFields(realm, message);
  const checked = realm.checkHooks(undefined);
  if (checked) await checked;
  reply(realm.send, message.id, fields);
}
