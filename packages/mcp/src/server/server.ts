// The MCP server of 03-api §9: tools/list from the registry, tools/call through the daemon, the two resources and their
// templates, as request handlers on the SDK's underlying server (the SDK's way for handlers of one's own: McpServer
// would make each tool's JSON Schema from Zod itself, and 09 §4.1 wants core's); the agent's name is the MCP client's
// `clientInfo.name` from its `initialize` (claude-code, …), declared on every call so the cells it touches carry it in
// `meta.lastEdit` (09 §4.7).
import { productName } from "@jsnb/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { rpcError } from "../errors/json.js";
import { defaultResultLimit } from "../errors/size.js";
import type { RequestContext, World } from "../io/world.js";
import { listResources, readResource, resourceTemplates } from "../resources/resources.js";
import { callTool } from "../tools/call.js";
import { tools } from "../tools/tools.js";
import { listingDescription, listingTitle, listingWebsite } from "./listing.js";

/** How much of the agent's name the daemon keeps (its declaration's limit). */
const agentLength = 200;

/**
 * The agent's name as an HTTP header carries it: printable ASCII only (a header value cannot hold the rest, and a
 * control character could split it), trimmed, at most what the daemon keeps; none when nothing is left.
 */
function agentName(name: string | undefined): string | undefined {
  const kept = name
    ?.replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, agentLength);
  return kept === undefined || kept === "" ? undefined : kept;
}

/** What the server tells the agent once, in its `initialize` answer. */
const instructions =
  "nimbo notebook tools, one per command of the nimbo API (cell.run is cell_run). Notebook paths are from the workspace " +
  "root (the nearest folder up from where the server runs that holds .jsnb/); a notebook a tool names is opened " +
  "first when it is not open, and notebook_create makes one. A server cell runs in the daemon's Node kernel; a client " +
  "cell runs in the page, so it needs the notebook open in a browser (`nimbo open <path>`). After an edit, " +
  "notebook_diagnostics gives the type errors without running anything; language_rename renames a name across " +
  "cells; notebook_bridge lists the server functions client cells can call, with their signatures. A large value is read in parts: cell_outputValue, or cell_outputQuery (filter, JSONPath, jq, or SQL over " +
  "table t), both on the last value output unless told another. Results are the command's JSON, as `nimbo … --json` " +
  "prints it, and at most 128 KiB: past it ResultTooLarge says what to call instead. Error messages name API " +
  "commands (notebook.open): the tool is the same name with _ (notebook_open); `nimbo add <name>` in a message is " +
  "packages_add. feedback_list reads the notes the user left on the running app; feedback_update marks one done. " +
  "keybindings_list, keybindings_set and keybindings_reset read and change the app's keyboard shortcuts (VS Code's " +
  "keybindings.json, user or workspace). " +
  "Read a notebook's changes with git_diff (cell by cell, with hunks), not by diffing its JSON; git_status lists " +
  "the changed files. A .jsnb file written directly while open is merged into its session by cell id, but the cell " +
  "tools keep outputs and need no reload; pass cell_get's textHash as base to cell_update.";

/** Rejects with the JSON-RPC error of 03-api §7.4 for a request that is no tool call. */
const answering = async <T>(work: Promise<T>): Promise<T> => {
  try {
    return await work;
  } catch (error) {
    throw rpcError(error);
  }
};

/** The server's settings (a test's): the cap on a result's frame, 128 KiB by default. */
export type McpOptions = { readonly resultLimit?: number };

/** The MCP server over `world`, not yet connected to a transport. */
export function createMcpServer(
  world: World,
  version: string,
  options: McpOptions = {},
): McpServer {
  const mcp = new McpServer(
    {
      name: productName,
      version,
      title: listingTitle,
      description: listingDescription,
      websiteUrl: listingWebsite,
    },
    { instructions },
  );
  const { server } = mcp;
  server.registerCapabilities({ tools: {}, resources: {} });
  const agent = (): string | undefined => agentName(server.getClientVersion()?.name);
  const resultLimit = options.resultLimit ?? defaultResultLimit;
  const context = ({ signal }: { readonly signal: AbortSignal }): RequestContext => ({
    world,
    agent,
    signal,
    resultLimit,
  });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...tools()] }));
  server.setRequestHandler(CallToolRequestSchema, ({ params }, extra) =>
    callTool(params.name, params.arguments, context(extra)),
  );
  server.setRequestHandler(ListResourcesRequestSchema, (_request, extra) =>
    answering(listResources(context(extra))),
  );
  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates: [...resourceTemplates],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, ({ params }, extra) =>
    answering(readResource(params.uri, context(extra))),
  );
  return mcp;
}
