// The registry contract of 09-testing §4 item 1, shared by every surface that exposes core's commands (the daemon's
// handlers, the cli's subcommands, the mcp server's tools): which registry commands a surface lacks, and which of its
// names the registry does not know. The daemon binds every command, internal ones included; the cli and mcp threads
// check their public commands the same way, and that no internal one leaks onto them.
import type { AnyCommand } from "@jsnb/core";
import { commands } from "@jsnb/core";

export type SurfaceCheck = {
  /** Registry commands the surface should have and does not. */
  readonly missing: readonly string[];
  /** Internal commands the surface has though it should not (`internal: "absent"`). */
  readonly leaked: readonly string[];
  /** Names the surface has that the registry does not know. */
  readonly unknown: readonly string[];
};

export type SurfaceOptions = {
  /** `"bound"`: internal commands belong on the surface too (the daemon); `"absent"`: they must not (cli, mcp). */
  readonly internal: "bound" | "absent";
  /** The names the surface lists of its own accord, checked against the registry (none to check: omit). */
  readonly names?: readonly string[];
};

/** Checks a surface against core's registry; `has` says whether the surface exposes one command. */
export async function checkSurface(
  has: (command: AnyCommand) => boolean | Promise<boolean>,
  options: SurfaceOptions,
): Promise<SurfaceCheck> {
  const missing: string[] = [];
  const leaked: string[] = [];
  for (const command of commands) {
    const present = await has(command);
    const expected = !command.tags.internal || options.internal === "bound";
    if (expected && !present) missing.push(command.name);
    if (!expected && present) leaked.push(command.name);
  }
  const known = new Set(commands.map((command) => command.name));
  const unknown = (options.names ?? []).filter((name) => !known.has(name));
  return { missing, leaked, unknown };
}
