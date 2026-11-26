// Where the daemon listens and how a connection declares itself: the bearer token, `client`, `agent`.
import type { EditInfo } from "@jsnb/core";

/** Which kind of client a connection is; the daemon stamps `meta.lastEdit` from it. */
export type ClientKind = EditInfo["client"];

/** The daemon to talk to and the declaration every request carries. */
export type DaemonOptions = {
  /** The daemon's origin, `http://127.0.0.1:<port>`; cli and mcp read it from `.jsnb/server.json`. */
  readonly url: string;
  /** The token of `.jsnb/server.json`. */
  readonly token: string;
  readonly client: ClientKind;
  /** The agent's name, such as `claude-code` from the MCP client info. */
  readonly agent?: string;
};

/** The bearer token and the client declaration of every HTTP request. */
export function httpHeaders(options: DaemonOptions): Record<string, string> {
  return {
    authorization: `Bearer ${options.token}`,
    "x-jsnb-client": options.client,
    ...(options.agent === undefined ? {} : { "x-jsnb-agent": options.agent }),
  };
}

/** A path on the daemon's HTTP origin, such as `/rpc`. */
export function httpUrl(options: DaemonOptions, path: string): URL {
  return new URL(path, options.url);
}

/** `ws://…/rpc?token=…&client=…&agent=…`: a browser cannot set headers on a WebSocket. */
export function socketUrl(options: DaemonOptions): string {
  const url = new URL("/rpc", options.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", options.token);
  url.searchParams.set("client", options.client);
  if (options.agent !== undefined) url.searchParams.set("agent", options.agent);
  return url.href;
}
