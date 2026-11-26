// The daemon's discovery file, `<workspace>/.jsnb/server.json`: `{ pid, port, token, startedAt,
// version, root }`, written by the server and read by every client that finds a daemon (the CLI, the MCP server).
import { z } from "zod";

export const ServerFile = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  token: z.string().min(1),
  startedAt: z.string(),
  version: z.string(),
  // The workspace's real path: a copied workspace carries the original's file, which must not name its daemon.
  root: z.string(),
});
export type ServerFile = z.infer<typeof ServerFile>;

/** The content of a server.json's text, or undefined when it is none (a half-written or foreign file). */
export function parseServerFile(text: string): ServerFile | undefined {
  try {
    const parsed = ServerFile.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    // Not JSON: a half-written or foreign file, which no live daemon left; a reader treats it as no daemon.
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
