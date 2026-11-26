// The connection's declaration: `?client=ui|cli|mcp|file&agent=<name>` on the WebSocket upgrade,
// `X-Jsnb-Client` and `X-Jsnb-Agent` over HTTP. An undeclared or unknown client counts as `cli`, so an unknown script
// is marked as an agent rather than as the user; the agent's name is kept to 200 characters.
import type { ClientKind, Declaration } from "../commands/context.js";

const kinds: readonly ClientKind[] = ["ui", "cli", "mcp", "file"];
const maxAgentLength = 200;

const kindOf = (value: string | undefined | null): ClientKind =>
  kinds.find((kind) => kind === value) ?? "cli";

/** The declaration from a `client` and an `agent` value, as the transport carried them. */
export function declarationOf(
  client: string | undefined | null,
  agent: string | undefined | null,
): Declaration {
  const name = agent?.trim().slice(0, maxAgentLength);
  return name ? { client: kindOf(client), agent: name } : { client: kindOf(client) };
}

/** A header's single value (a repeated header counts as absent). */
export const headerValue = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;
