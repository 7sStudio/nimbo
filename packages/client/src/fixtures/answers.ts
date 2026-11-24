// What the test peer's method handlers return: a JSON-RPC result or error, a raw body, or a dropped connection.
export type WireAnswer =
  | { readonly result: unknown }
  | { readonly error: { readonly code: number; readonly message: string; readonly data?: unknown } }
  /** Sent as it is (HTTP: with `status`, 200 by default). */
  | { readonly raw: string; readonly status?: number }
  /** Ends the connection without answering. */
  | { readonly destroy: true };

/** What a handler may do with the socket a call came on (PeerSocket has it all). */
export type PeerChannel = {
  readonly notify: (method: string, params: unknown) => void;
  readonly send: (text: string) => void;
};

type CallContext =
  | { readonly transport: "http"; readonly headers: Readonly<Record<string, unknown>> }
  | { readonly transport: "ws"; readonly socket: PeerChannel };

export type MethodHandler = (
  params: unknown,
  context: CallContext,
) => WireAnswer | Promise<WireAnswer>;

/** The answer to a method nobody registered. */
export const methodNotFound: MethodHandler = () => ({
  error: { code: -32601, message: "Method not found" },
});
