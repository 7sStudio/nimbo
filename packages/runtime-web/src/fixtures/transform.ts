// The daemon's transform for the tests: the `transformCell` browser command of vitest.config.ts,
// which runs @jsnb/transform in Node; runtime-web never imports it.
import { commands } from "vitest/browser";
import { z } from "zod";

const Outcome = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), code: z.string(), map: z.string() }),
  z.object({ ok: z.literal(false), name: z.string(), message: z.string() }),
]);
export type TransformOutcome = z.infer<typeof Outcome>;

/** The command is reached by name and its answer parsed, so no type of vitest.config.ts leaks into the page. */
export async function transformCell(source: string, filename: string): Promise<TransformOutcome> {
  const command: unknown = Reflect.get(commands, "transformCell");
  if (typeof command !== "function") {
    throw new Error("the runtime-web project has no transformCell command (vitest.config.ts)");
  }
  const answer: unknown = await Reflect.apply(command, commands, [source, filename]);
  return Outcome.parse(answer);
}
