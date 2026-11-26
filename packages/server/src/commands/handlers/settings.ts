// The settings commands: effective values with their sources, a validated write, the JSON Schema.
import {
  InvalidParams,
  settingsFile,
  settingsGet,
  settingsJsonSchema,
  settingsSchemaCommand,
  settingsSet,
  settingsWriteFile,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function settingsHandlers({ workspace }: Services): readonly Bound[] {
  return [
    bind(settingsGet, ({ key }) => ({ values: workspace.settings.get(key) })),
    bind(settingsSet, async ({ key, value, scope, reset }) => {
      // a missing value is a mistake unless reset says so: an agent that forgets it never deletes the key
      if (value === undefined && reset !== true)
        throw new InvalidParams({
          issues: [{ path: ["value"], message: "Required unless reset is true" }],
        });
      return {
        value: await workspace.settings.set(key, reset === true ? undefined : value, scope),
      };
    }),
    bind(settingsSchemaCommand, () => ({ schema: settingsJsonSchema() })),
    bind(settingsFile, ({ scope }) => workspace.settings.file(scope)),
    bind(settingsWriteFile, async ({ scope, text }) => {
      await workspace.settings.writeFile(scope, text);
      return {};
    }),
  ];
}
