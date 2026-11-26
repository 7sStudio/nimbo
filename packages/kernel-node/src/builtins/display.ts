// The server `display` built-in: display.html, display.json, display.table and display.image emit
// `display` outputs on the calling cell.
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

import type { Output } from "@jsnb/core";

export type DisplayOptions = {
  /** Emits an output under the current store. */
  readonly emit: (output: Output) => void;
  /** A value's wire form under the output limits, its strings redacted (core's encode). */
  readonly encode: (value: unknown) => unknown;
  readonly redact: (text: string) => string;
  /** Where a relative image path is read from (the kernel's cwd, the workspace). */
  readonly cwd?: string;
};

type TableOptions = { readonly columns?: readonly string[] };
type ImageOptions = { readonly mime?: string };

export type Display = {
  readonly html: (html: unknown) => void;
  readonly json: (value: unknown) => void;
  readonly table: (rows: unknown, options?: TableOptions) => void;
  readonly image: (source: unknown, options?: ImageOptions) => void;
};

/** The mime of display.table: the rows' JSON, shown as a grid. */
const tableMime = "application/vnd.jsnb.table+json";

type DisplayOutput = Extract<Output, { readonly kind: "display" }>;

/** Captured when the module loads: a cell that replaces JSON.stringify breaks its own code only. */
const stringify = JSON.stringify.bind(JSON);

const byExtension: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/** The image type of bytes by their signature; undefined when none matches. */
function sniff(bytes: Uint8Array): string | undefined {
  const at = (index: number, ...values: number[]) =>
    values.every((value, offset) => bytes[index + offset] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x42, 0x4d)) return "image/bmp";
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")))
    return "image/svg+xml";
  return undefined;
}

/** Bytes from any realm (a cell's Buffer may come from another context than this module's). */
const isBytes = (value: unknown): value is Uint8Array | ArrayBuffer =>
  ArrayBuffer.isView(value) || Object.prototype.toString.call(value) === "[object ArrayBuffer]";

/** An image output from bytes: base64 of the sniffed (or given) type; SVG as its text. */
function fromBytes(value: Uint8Array | ArrayBuffer, mime: string | undefined): DisplayOutput {
  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  const type = mime ?? sniff(bytes);
  if (type === undefined)
    throw new TypeError("display.image: unknown image type; pass { mime: 'image/png' }");
  if (type === "image/svg+xml")
    return { kind: "display", mime: type, data: new TextDecoder().decode(bytes) };
  return { kind: "display", mime: type, data: Buffer.from(bytes).toString("base64") };
}

/** A data URL's image: base64 as given, SVG text decoded, any other type's text encoded. */
function fromDataUrl(match: RegExpExecArray): DisplayOutput {
  const type = match[1] ?? "image/png";
  const base64 = match[2] !== undefined;
  const body = match[3] ?? "";
  if (base64) return { kind: "display", mime: type, data: body };
  const text = decodeURIComponent(body);
  return type === "image/svg+xml"
    ? { kind: "display", mime: type, data: text }
    : { kind: "display", mime: type, data: Buffer.from(text).toString("base64") };
}

/** A data URL, an http(s) URL kept as a link, SVG markup, or a file path read from `cwd`. */
function fromString(text: string, mime: string | undefined, cwd: string): DisplayOutput {
  const data = /^data:(image\/[\w.+-]+)(;base64)?,(.*)$/su.exec(text);
  if (data) return fromDataUrl(data);
  if (/^data:/iu.test(text))
    throw new TypeError("display.image: a data URL must be an image's (data:image/...)");
  if (/^https?:\/\//iu.test(text)) {
    const type = mime ?? byExtension[extname(new URL(text).pathname).toLowerCase()] ?? "image/png";
    return { kind: "display", mime: type, data: text };
  }
  if (text.trimStart().startsWith("<svg"))
    return { kind: "display", mime: "image/svg+xml", data: text };
  const path = resolve(cwd, text);
  return fromBytes(readFileSync(path), mime ?? byExtension[extname(path).toLowerCase()]);
}

/** An array as it is; a Map's or an object's entries as `{ key, value }` rows; anything else one row. */
function listOf(rows: unknown): readonly unknown[] {
  if (Array.isArray(rows)) return rows;
  if (rows instanceof Map)
    return [...rows.entries()].map(([key, value]: [unknown, unknown]) => ({ key, value }));
  if (rows !== null && typeof rows === "object")
    return Object.entries(rows).map(([key, value]: [string, unknown]) => ({ key, value }));
  return [rows];
}

/** The rows of display.table; `columns` picks and orders the keys of each object row. */
function rowsOf(rows: unknown, columns: readonly string[] | undefined): readonly unknown[] {
  const list = listOf(rows);
  if (columns === undefined) return list;
  return list.map((row) =>
    row !== null && typeof row === "object"
      ? Object.fromEntries(columns.map((key) => [key, Reflect.get(row, key)]))
      : row,
  );
}

/** `display` for server cells. */
export function createDisplay(options: DisplayOptions): Display {
  const cwd = options.cwd ?? process.cwd();
  return Object.freeze({
    html: (html: unknown) => {
      const data = options.redact(typeof html === "string" ? html : String(html));
      options.emit({ kind: "display", mime: "text/html", data });
    },
    json: (value: unknown) => {
      const data = stringify(options.encode(value));
      options.emit({ kind: "display", mime: "application/json", data });
    },
    table: (rows: unknown, table?: TableOptions) => {
      const data = stringify(options.encode(rowsOf(rows, table?.columns)));
      options.emit({ kind: "display", mime: tableMime, data });
    },
    image: (source: unknown, image?: ImageOptions) => {
      const mime = image?.mime;
      const output = isBytes(source)
        ? fromBytes(source, mime)
        : fromString(String(source), mime, cwd);
      // base64 bytes carry no text to redact; SVG markup and a URL do
      const text = output.mime === "image/svg+xml" || /^https?:/iu.test(output.data);
      options.emit(text ? { ...output, data: options.redact(output.data) } : output);
    },
  });
}
