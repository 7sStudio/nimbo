// The page's socket as runtime-web sees it: one JSON-RPC request at a time, provided by the host.

/** The host's socket (ui's `realm/mount.ts`); runtime-web never opens a WebSocket itself. */
export type RealmTransport = {
  /**
   * One JSON-RPC request on the page's socket: resolves with `result`, rejects with the call failure (an object
   * carrying the JSON-RPC `code`, `message` and `data`, such as core's `ApiError` or a plain error object).
   */
  readonly call: (method: string, params: unknown) => Promise<unknown>;
};
