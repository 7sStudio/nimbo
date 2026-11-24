// settingsJsonSchema: the JSON Schema of the settings object with each key's title and status (07-file-format §6).
import { z } from "zod";

import { settingsKeys, settingsMeta, settingsSchema } from "./schema.js";

export type SettingsJsonSchema = {
  readonly $schema: string;
  readonly type: "object";
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly additionalProperties: boolean;
};

/** The schema `settings.schema` returns and `nimbo config schema` prints. */
export function settingsJsonSchema(): SettingsJsonSchema {
  const generated = z.toJSONSchema(settingsSchema, { io: "input" });
  const base: Readonly<Record<string, unknown>> = generated.properties ?? {};
  const properties = Object.fromEntries(
    settingsKeys.map((key) => {
      const property = base[key];
      const known = typeof property === "object" && property !== null ? property : {};
      const { title, status } = settingsMeta[key];
      return [key, { ...known, title, status }];
    }),
  );
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties,
    additionalProperties: true,
  };
}
