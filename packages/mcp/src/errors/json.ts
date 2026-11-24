// A failure as the agent reads it (03-api §9, as the CLI's `--json` failure of §8): `{ code, name, message, data }`,
// the JSON-RPC code of a daemon error or null for the MCP server's and the client's own; a -32603 carrying a named
// JsnbError gives that name and its data (03-api §7.4).
import { ApiError, isJsnbError } from "@jsnb/core";

export type ErrorJson = {
  readonly code: number | null;
  readonly name: string;
  readonly message: string;
  readonly data: unknown;
};

/** -32603 carrying a named JsnbError (`data: { name, data }`): that name and its data. */
function namedInternal(error: ApiError): { name: string; data: unknown } | undefined {
  if (error.code !== -32603 || typeof error.data.name !== "string") return undefined;
  return { name: error.data.name, data: error.data.data ?? {} };
}

/** The JSON form of any failure; an error that is none of nimbo's keeps its name and message. */
export function errorJson(error: unknown): ErrorJson {
  if (error instanceof ApiError) {
    const named = namedInternal(error);
    return {
      code: error.code,
      name: named?.name ?? error.name,
      message: error.message,
      data: named?.data ?? error.data,
    };
  }
  if (isJsnbError(error)) {
    return { code: null, name: error.name, message: error.message, data: error.data };
  }
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return { code: null, name, message, data: {} };
}

/**
 * The error a request that is no tool call (resources/read, resources/list) rejects with, which the SDK sends as the
 * JSON-RPC error from its `code`, `message` and `data`: a daemon error as the daemon sent it, any other as -32603
 * carrying its name and data, as the daemon carries a named JsnbError.
 */
export function rpcError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const { name, message, data } = errorJson(error);
  return new ApiError(-32603, { name, message, data: { name, data }, cause: error });
}
