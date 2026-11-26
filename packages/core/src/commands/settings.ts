// The settings commands; the keys come from the settings schema.
import { z } from "zod";

import { resolvedValueSchema } from "../model/settings.js";
import { settingsKeys } from "../settings/schema.js";
import { defineCommand } from "./define.js";

const key = z.enum(settingsKeys);
export const settingsGet = defineCommand({
  name: "settings.get",
  description:
    "The effective values, each with the source it comes from and the value the user and the workspace file each set (absent when that file does not set the key); one key or all of them.",
  input: z.object({ key: key.optional() }),
  output: z.object({ values: z.record(z.string(), resolvedValueSchema) }),
});

export const settingsSet = defineCommand({
  name: "settings.set",
  description:
    "Validate a value, write it to the user or workspace file (the workspace's outranks the user's, as in VS Code) and apply it at once; with reset, the key leaves that file instead. Planned keys are refused.",
  input: z.object({
    key,
    value: z.unknown().optional(),
    scope: z.enum(["user", "workspace"]).default("workspace"),
    reset: z.boolean().optional(),
  }),
  output: z.object({ value: z.unknown().optional() }),
  tags: { mutating: true },
});

const scope = z.enum(["user", "workspace"]);

export const settingsFile = defineCommand({
  name: "settings.file",
  description:
    "Called by the page's Settings (JSON): the user or workspace settings file as text, empty when it does not exist.",
  input: z.object({ scope }),
  output: z.object({ path: z.string(), text: z.string() }),
  tags: { internal: true },
});

export const settingsWriteFile = defineCommand({
  name: "settings.writeFile",
  description:
    "Called by the page's Settings (JSON): the settings file replaced by `text` (JSONC, one object of keys), applied at once.",
  input: z.object({ scope, text: z.string() }),
  output: z.object({}),
  tags: { internal: true, mutating: true },
});

export const settingsSchemaCommand = defineCommand({
  name: "settings.schema",
  description:
    "The JSON Schema of the settings, with titles and status, for the panel and external tools.",
  input: z.object({}),
  output: z.object({ schema: z.record(z.string(), z.unknown()) }),
});
