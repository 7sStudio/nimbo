// Public API of @jsnb/mcp: the MCP server whose tools are generated from the registry, served on a world's
// stdio, and the world it runs against.
export { serveStdio } from "./server/serve.js";
export { createMcpServer } from "./server/server.js";
export type { McpOptions } from "./server/server.js";
export type { RequestContext, Spawn, World } from "./io/world.js";
export { processWorld } from "./io/process.js";
