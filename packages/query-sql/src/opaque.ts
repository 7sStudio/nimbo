// DuckDB's integer types with no Arrow type, which DuckDB-WASM sends as Arrow's `arrow.opaque` extension (their bytes,
// named in the field's metadata): UHUGEINT and BIGNUM read by the bigint rule at any depth, any other refused rather
// than shown as bytes. A MAP's key and value fields lose that metadata on the way (11-query §3).
import type { Data, Field } from "apache-arrow";
import { DataType } from "apache-arrow";

import { QueryError, messages } from "./errors.ts";
import { bigintToJson } from "./formats.ts";
import type { Read } from "./scalars.ts";
import { fixedBinary, variable } from "./scalars.ts";

/** Whose Arrow is read: a DuckDB-WASM result, or a caller's table on its way into an engine. */
export type Origin = "duckdb" | "table";

const extensionName = "ARROW:extension:name";

/** The `type_name` of an opaque field's extension metadata (`{"type_name":"uhugeint","vendor_name":"DuckDB"}`). */
function metadataName(text: string | undefined): string {
  try {
    const metadata: unknown = JSON.parse(text ?? "");
    const name: unknown =
      typeof metadata === "object" && metadata !== null
        ? Reflect.get(metadata, "type_name")
        : undefined;
    return typeof name === "string" ? name : "opaque";
  } catch {
    // Metadata that is not JSON names no type: the field is refused as an unknown opaque type, never read as bytes.
    return "opaque";
  }
}

/**
 * DuckDB's lower-case name for the type of an opaque field (`uhugeint`, `bignum` …), or `undefined`. Where a MAP lost
 * the metadata, a FixedSizeBinary(16) in a DuckDB-WASM result is still a UHUGEINT: it sends no other type that way.
 */
export function opaqueName(
  field: Field | undefined,
  type: DataType,
  origin: Origin,
): string | undefined {
  const extension = field?.metadata.get(extensionName);
  if (extension === "arrow.opaque") {
    return metadataName(field?.metadata.get("ARROW:extension:metadata"));
  }
  const unlabelled =
    extension === undefined && DataType.isFixedSizeBinary(type) && type.byteWidth === 16;
  return origin === "duckdb" && unlabelled ? "uhugeint" : undefined;
}

/** UHUGEINT: 16 bytes, an unsigned little-endian integer. */
export function uhugeint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }
  return value;
}

/**
 * BIGNUM: a 3-byte header (its top bit set for a number ≥ 0, then the byte count) and the big-endian magnitude; a
 * negative number has every bit flipped, header and magnitude alike.
 */
export function bignum(bytes: Uint8Array): bigint {
  const negative = ((bytes[0] ?? 0) & 0x80) === 0;
  let value = 0n;
  for (const byte of bytes.subarray(3))
    value = (value << 8n) | BigInt(negative ? ~byte & 0xff : byte);
  return negative ? -value : value;
}

/** The reader for an opaque type; a type it does not know is refused when its first row is read. */
export function opaqueReader(data: Data, name: string): Read {
  if (name === "uhugeint") return fixedBinary(data, 16, (bytes) => bigintToJson(uhugeint(bytes)));
  if (name === "bignum") return variable(data, (bytes) => bigintToJson(bignum(bytes)));
  return () => {
    throw new QueryError("query", messages.opaque(name));
  };
}
