// The shared value corpus (fixtures/values/*.json at the repository root).
import { readdirSync, readFileSync } from "node:fs";

import { z } from "zod";

import type { SerializedValue } from "../outputs/value.js";

/** One case; a case without `source` belongs to another package (output-view's) and is not run here. */
const ValueCase = z.object({
  name: z.string(),
  source: z.string().optional(),
  json: z.unknown(),
  repr: z.string(),
  truncated: z.boolean(),
});

export type RunnableCase = SerializedValue & {
  readonly file: string;
  readonly name: string;
  readonly source: string;
};

const directory = new URL("../../../../fixtures/values/", import.meta.url);

/** Every case with a source, from every JSON file of the corpus directory. */
export function valueCases(): readonly RunnableCase[] {
  const files = readdirSync(directory).filter((name) => name.endsWith(".json"));
  return files.flatMap((file) => {
    const cases = z
      .array(ValueCase)
      .parse(JSON.parse(readFileSync(new URL(file, directory), "utf8")));
    return cases.flatMap(({ source, ...rest }) =>
      source === undefined ? [] : [{ file, source, ...rest }],
    );
  });
}
