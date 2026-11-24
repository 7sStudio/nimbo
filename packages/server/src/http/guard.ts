// The network rules of 03-api §7.1 and 02-architecture §8 that hold before anything else: the `Host` must name this
// daemon (127.0.0.1 or localhost with its port: DNS-rebinding protection), and an `Origin`, when a browser sends one,
// must be the daemon's own origin, so no other web page can drive it. Node clients (CLI, MCP) send no Origin.
import type { IncomingHttpHeaders } from "node:http";

const hostsOf = (port: number): readonly string[] => [
  `127.0.0.1:${String(port)}`,
  `localhost:${String(port)}`,
];

/** The daemon's own origins: the page it serves runs on one of them. */
const originsOf = (port: number): readonly string[] =>
  hostsOf(port).map((host) => `http://${host}`);

/** Whether a request's headers may reach the daemon listening on `port`. */
export function isAllowed(headers: IncomingHttpHeaders, port: number): boolean {
  const host = headers.host?.toLowerCase();
  if (host === undefined || !hostsOf(port).includes(host)) return false;
  const origin = headers.origin;
  return origin === undefined || originsOf(port).includes(origin.toLowerCase());
}
