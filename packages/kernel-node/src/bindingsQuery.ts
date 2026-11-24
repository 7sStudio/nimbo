// The `bindings` request (03-api kernel.scope, cell.bindings; 04-kernel §5.2): each existing scope name with its
// kind, preview, defining cell and export flag, and with `full` its value serialized like a value output. A name whose
// value cannot be read or described is listed all the same, saying so, and the other names still answer (§2.1).
import type { Binding, BindingValue } from "@jsnb/core";

import type { BindingsMessage } from "./ipc/messages.js";
import { cut } from "./outputs/cut.js";
import { preview, previewLimit } from "./outputs/preview.js";
import { serializeValue } from "./outputs/value.js";
import type { Realm } from "./realm.js";
import type { ResultFields } from "./result.js";
import { reply } from "./result.js";

const isListed = (record: object, name: string): boolean =>
  Object.getOwnPropertyDescriptor(record, name)?.enumerable === true;

type Metadata = Omit<Binding, "preview">;

/** A binding whose value threw while it was read or described: the preview says so, and `full` carries the error. */
function unreadable(
  realm: Realm,
  metadata: Metadata,
  error: unknown,
  full: boolean,
): Binding | BindingValue {
  const { name, message } = realm.errorInfo(error);
  const text = cut(`[the value could not be read: ${name}: ${message}]`, previewLimit);
  const binding: Binding = { ...metadata, preview: text };
  if (!full) return binding;
  return { ...binding, json: { $type: "error", name, message }, repr: text, truncated: true };
}

function bindingOf(realm: Realm, name: string, full: boolean): Binding | BindingValue | undefined {
  const { record } = realm.scope;
  const info = realm.names.get(name);
  if (!info || !isListed(record, name)) return undefined;
  const metadata: Metadata = {
    name,
    kind: info.kind,
    definedBy: info.definedBy,
    exported: realm.exports.isExported(name),
  };
  const { redact } = realm.environment;
  try {
    const value = record[name];
    const binding: Binding = { ...metadata, preview: preview(value, redact) };
    return full ? { ...binding, ...serializeValue(value, realm.config.limits, redact) } : binding;
  } catch (error) {
    // The value fought back (a getter, a custom inspect): this name says so, the others still answer.
    return unreadable(realm, metadata, error, full);
  }
}

/**
 * Answers one `bindings` message: the requested names that exist (all, without `names`), metadata required. Reading
 * and describing the values can run user code (a getter, a custom inspect), so the process hooks are checked before
 * the answer leaves (04-kernel §3.3).
 */
export async function bindingsFlow(realm: Realm, message: BindingsMessage): Promise<void> {
  const names = message.names ?? realm.scope.names();
  const full = message.full === true;
  let fields: ResultFields;
  try {
    fields = { value: names.flatMap((name) => bindingOf(realm, name, full) ?? []) };
  } catch (error) {
    // A step of the kernel's own failed (the scope's names could not be listed): the request gets that error.
    fields = { error: realm.errorInfo(error) };
  }
  const checked = realm.checkHooks(undefined);
  if (checked) await checked;
  reply(realm.send, message.id, fields);
}
