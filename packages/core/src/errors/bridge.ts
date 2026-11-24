// The bridge error catalogue of 05-bridge §7: what a client cell sees when a name or a value cannot cross.
import type { CellId } from "../model/ids.js";
import { JsnbError } from "./jsnbError.js";

type Cause = { readonly cause?: unknown };

/** Renders a call's arguments the way the catalogue prints them: `createIntent(2000)`. */
const renderCall = (name: string, args: readonly unknown[]): string =>
  `${name}(${args.map((arg) => (arg === undefined ? "undefined" : JSON.stringify(arg))).join(", ")})`;

const seconds = (ms: number): string => `${String(ms / 1000)}s`;

/** `cell` is the defining cell's id; `index` its 1-based position, the way the catalogue names it. */
type Named = { readonly name: string; readonly cell: CellId; readonly index: number };
/** A name only the kernel still holds as an export: the server cell that exported it was deleted or edited (05 §5). */
type Gone = { readonly name: string };
const notExportedMessage = (data: Named | Gone): string =>
  "index" in data
    ? `${data.name} is defined in server cell ${String(data.index)} but not exported. Add export in that cell to use it here.`
    : `${data.name} is no longer exported by any server cell. Export it from a server cell to use it here.`;

export class NotExported extends JsnbError {
  declare readonly data: Named | Gone;
  constructor(data: Named | Gone, options: Cause = {}) {
    super({ name: "NotExported", message: notExportedMessage(data), data, ...options });
  }
}

/**
 * The mirror of NotExported: a server cell uses a name only a client cell defines. The page's realm
 * holds it and the server cannot reach into the page, so the server run fails before it starts.
 */
export class DefinedInClient extends JsnbError {
  declare readonly data: Named;
  constructor(data: Named, options: Cause = {}) {
    super({
      name: "DefinedInClient",
      message: `${data.name} is defined in client cell ${String(data.index)}; server cells can't call into the page. Switch this cell to client, or move ${data.name} to a server cell and export it.`,
      data,
      ...options,
    });
  }
}

type Typed = { readonly name: string; readonly type: string };
/** Bytes are plain data: one over `bridge.maxBytesPerValue` (`limit`) is refused for its size alone (05 §2). */
type Sized = { readonly bytes: number; readonly limit: number };
type Refused = Typed | (Typed & Sized);

const isSized = (data: Refused): data is Typed & Sized => "bytes" in data;

/** "a Uint8Array of 2048 bytes, more than bridge.maxBytesPerValue (1024 bytes) lets cross". */
const oversized = ({ type, bytes, limit }: Typed & Sized): string =>
  `${article(type)} ${type} of ${String(bytes)} bytes, more than bridge.maxBytesPerValue (${String(limit)} bytes) lets cross`;

/** `type` is the value's class name, or `class` for an exported class itself (05 §2: refused, not shipped). */
const notTransferableMessage = (data: Refused): string => {
  if (isSized(data))
    return `${data.name} is ${oversized(data)}. Raise the setting, or export a function that returns part of it.`;
  const what = data.type === "class" ? "a class" : `${article(data.type)} ${data.type} instance`;
  return `${data.name} is ${what} on the server and cannot be copied to the browser. Export a function that uses it instead.`;
};

export class NotTransferable extends JsnbError {
  declare readonly data: Refused;
  constructor(data: Refused, options: Cause = {}) {
    super({ name: "NotTransferable", message: notTransferableMessage(data), data, ...options });
  }
}

type Argument = { readonly name: string; readonly argIndex: number; readonly type: string };
/** `argIndex` is zero-based like the array it indexes; the message counts from one like a person does. */
const argumentNotSerializableMessage = (data: Argument | (Argument & Sized)): string => {
  const which = `Argument ${String(data.argIndex + 1)} of ${data.name}(...)`;
  if ("bytes" in data)
    return `${which} is ${oversized(data)}. Raise the setting, or send it in parts.`;
  return `${which} is ${article(data.type)} ${data.type} and cannot be sent to the server.`;
};

export class ArgumentNotSerializable extends JsnbError {
  declare readonly data: Argument | (Argument & Sized);
  constructor(data: Argument | (Argument & Sized), options: Cause = {}) {
    super({
      name: "ArgumentNotSerializable",
      message: argumentNotSerializableMessage(data),
      data,
      ...options,
    });
  }
}

const resultNotSerializableMessage = (data: Refused): string =>
  isSized(data)
    ? `${data.name} returned ${oversized(data)}. Raise the setting, or return part of it.`
    : `${data.name} returned ${article(data.type)} ${data.type} instance, which cannot be sent to the browser. Return plain data.`;

export class ResultNotSerializable extends JsnbError {
  declare readonly data: Refused;
  constructor(data: Refused, options: Cause = {}) {
    super({
      name: "ResultNotSerializable",
      message: resultNotSerializableMessage(data),
      data,
      ...options,
    });
  }
}

type Timeout = {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly timeoutMs: number;
};
const rpcTimeoutMessage = ({ name, args, timeoutMs }: Timeout): string =>
  `${renderCall(name, args)} did not answer within ${seconds(timeoutMs)}. The server cell may be blocked; try kernel.interrupt.`;

export class RpcTimeout extends JsnbError {
  declare readonly data: Timeout;
  constructor(data: Timeout, options: Cause = {}) {
    super({ name: "RpcTimeout", message: rpcTimeoutMessage(data), data, ...options });
  }
}

const exportNotRunMessage = ({ name, index }: Named): string =>
  `${name} is exported by server cell ${String(index)}, but the kernel does not have that export yet. Run server cell ${String(index)} to make it.`;

/** A client cell uses a name a server cell's source exports and the kernel does not hold: the cell has not run since the
 * kernel started, it ran before the export was written, or its run ended before reaching it (05-bridge §3, §7). */
export class ExportNotRun extends JsnbError {
  declare readonly data: Named;
  constructor(data: Named, options: Cause = {}) {
    super({ name: "ExportNotRun", message: exportNotRunMessage(data), data, ...options });
  }
}

const kernelRestartedMessage = ({ name, index }: Named): string =>
  `${name} was defined before the kernel restarted. Re-run server cell ${String(index)}.`;

export class KernelRestarted extends JsnbError {
  declare readonly data: Named;
  constructor(data: Named, options: Cause = {}) {
    super({ name: "KernelRestarted", message: kernelRestartedMessage(data), data, ...options });
  }
}

/** The letters whose spoken name starts with a vowel sound: an HTML…, an SVG…, an XML…, but a URL…, a DOM…. */
const vowelLetters = /^[AEFHILMNORSX]/;

/** "an HTMLDivElement", "an S3Client", "a Stripe", "a Uint8Array", "an Update", "a URL": the indefinite article by the
 * first sound, a name that opens with an acronym (a capital before a capital or a digit) read letter by letter, and a
 * U read "you" before -ni, -s, -t, -r and in Uint. */
function article(type: string): string {
  if (/^[A-Z][A-Z0-9]/.test(type)) return vowelLetters.test(type) ? "an" : "a";
  if (/^U/i.test(type)) return /^U(ni|s|t|r|int)/i.test(type) ? "a" : "an";
  return /^[AEIO]/i.test(type) ? "an" : "a";
}
