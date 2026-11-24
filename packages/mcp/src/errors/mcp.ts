// The MCP server's own failures besides the daemon's (daemon.ts): a NIMBO_DAEMON_ENTRY it may not fork, a working
// folder deleted from under it, and a resource URI that names nothing of nimbo's (MCP's -32002, "resource not found").
import { ApiError, JsnbError } from "@jsnb/core";

/** The cause an error keeps, as Error's own option. */
export type Cause = { readonly cause?: unknown };

/** The variable at fault, and the tool whose call read it. */
export type ArgumentsData = { readonly argument: string; readonly command: string };

/** A setting of the MCP server's environment cannot be used (NIMBO_DAEMON_ENTRY not an absolute path to a file). */
export class InvalidArguments extends JsnbError {
  declare readonly data: ArgumentsData;
  constructor(data: ArgumentsData, reason: string, options: Cause = {}) {
    super({ name: "InvalidArguments", message: reason, data, ...options });
  }
}

/** The MCP server's working folder was deleted (or moved) from under it, so no workspace can be found. */
export class WorkingFolderGone extends JsnbError {
  declare readonly data: Readonly<Record<string, never>>;
  constructor(options: Cause = {}) {
    super({
      name: "WorkingFolderGone",
      message:
        "The MCP server's working folder no longer exists (deleted or moved). Restart the server from the workspace folder.",
      data: {},
      ...options,
    });
  }
}

/** MCP's code for a resource that does not exist (the 2025-06-18 specification, Resources § Error Handling). */
const resourceNotFoundCode = -32002;

/** A URI that is neither `nimbo://notebook/<path>` nor `nimbo://cell/<path>/<id>` (03-api §9). */
export class UnknownResource extends ApiError {
  declare readonly data: { readonly uri: string };
  constructor(data: { readonly uri: string }, options: Cause = {}) {
    super(resourceNotFoundCode, {
      name: "UnknownResource",
      message: `${data.uri} is no nimbo resource: use nimbo://notebook/<path> or nimbo://cell/<path>/<cell id>, the path from the workspace root.`,
      data,
      ...options,
    });
  }
}

/**
 * A tools/call naming no tool of this server (an internal command's name included): the protocol's InvalidParams, as
 * MCP's tools specification has it for an unknown tool, not a tool result.
 */
export class UnknownTool extends ApiError {
  declare readonly data: { readonly tool: string };
  constructor(data: { readonly tool: string }, options: Cause = {}) {
    super(-32602, { name: "UnknownTool", message: `Unknown tool: ${data.tool}`, data, ...options });
  }
}

/** A size as a result's size is told: KiB under one MiB, else MiB with one decimal. */
const sizeText = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${String(Math.ceil(bytes / 1024))} KiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/** The tool (or `resources/read`) whose result was too large, its size and the cap, in bytes. */
export type ResultSize = { readonly tool: string; readonly bytes: number; readonly limit: number };

/**
 * A result whose whole frame passes the cap: not sent, so the agent's session outlives it (an MCP client
 * ends it past its 10 MiB line). `advice` names the exact call to make instead; `carriedOut` says a tool that changes
 * something did change it.
 */
export class ResultTooLarge extends JsnbError {
  declare readonly data: ResultSize;
  constructor(data: ResultSize, advice: string, carriedOut: boolean, options: Cause = {}) {
    const done = carriedOut ? "; the call itself was carried out" : "";
    // At the edge both round to the same figure: then the exact byte counts tell them apart.
    const [size, cap] =
      sizeText(data.bytes) === sizeText(data.limit)
        ? [`${String(data.bytes)} bytes`, `${String(data.limit)} bytes`]
        : [sizeText(data.bytes), sizeText(data.limit)];
    super({
      name: "ResultTooLarge",
      message: `${data.tool}'s result is ${size}, more than the ${cap} a result may carry, so it was not sent${done}. ${advice}`,
      data,
      ...options,
    });
  }
}
