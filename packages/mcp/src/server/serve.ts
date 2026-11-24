// `nimbo mcp` end to end: the MCP server on the world's stdio until the agent closes stdin or stops reading, then the
// exit code (0, or 1 when the transport failed otherwise); protocol errors the SDK reports go to stderr, the server's
// log, whose own failures are heard here so a closed log is no uncaught `error` event.
import { productVersion } from "@jsnb/core";

import type { World } from "../io/world.js";
import type { McpOptions } from "./server.js";
import { createMcpServer } from "./server.js";
import { StdioTransport } from "./stdio.js";

/** The product's version, as `nimbo --version` gives it (core's, stamped by a release build). */
const packageVersion = (): string => productVersion;

/** Serves MCP on `world`'s stdin and stdout; resolves with the exit code once the transport closed. */
export async function serveStdio(world: World, options: McpOptions = {}): Promise<number> {
  // stderr is the server's log: a line lost once the agent closed it is no reason to fail (stdout is the transport's).
  if (world.stderr.listenerCount("error") === 0) world.stderr.on("error", () => undefined);
  const mcp = createMcpServer(world, packageVersion(), options);
  const transport = new StdioTransport(world.stdin, world.stdout);
  const closed = new Promise<number>((resolve) => {
    mcp.server.onclose = () => {
      resolve(transport.failed ? 1 : 0);
    };
  });
  mcp.server.onerror = (error) => {
    world.stderr.write(`nimbo mcp: ${error.message}\n`);
  };
  await mcp.connect(transport);
  return closed;
}
