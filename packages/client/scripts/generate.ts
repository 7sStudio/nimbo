// Writes src/generated.ts: renders the client from @jsnb/core's registry and formats it with the repository's Prettier.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as core from "@jsnb/core";
import { format, resolveConfig } from "prettier";

import type { NamedCommand } from "./render.js";
import { renderClient } from "./render.js";

/** The one committed generated file. */
export const generatedPath = fileURLToPath(new URL("../src/generated.ts", import.meta.url));

/** Every registry command with the name @jsnb/core exports it under, so generated.ts can import it. */
export function namedCommands(): readonly NamedCommand[] {
  const exported = Object.entries(core);
  return core.commands.map((command) => {
    const entry = exported.find(([, value]) => value === command);
    if (!entry) {
      throw new core.JsnbError({
        name: "UnexportedCommand",
        message: `${command.name} is in the registry but @jsnb/core does not export it by name; export it.`,
        data: { command: command.name },
      });
    }
    return { exportName: entry[0], command };
  });
}

/** The text of generated.ts exactly as Prettier formats it with the repository's configuration. */
export async function generatedSource(): Promise<string> {
  const config = await resolveConfig(generatedPath);
  return format(renderClient(namedCommands()), { ...config, filepath: generatedPath });
}

if (import.meta.main) await writeFile(generatedPath, await generatedSource());
