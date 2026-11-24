// The server → page requests of 03-api §4.5 the host routes to `Realm.handle`, and their params at the boundary.
import { InvalidParams } from "@jsnb/core";
import type { z } from "zod";

export const realmRequestMethods = [
  "realm.execute",
  "realm.reset",
  "realm.snapshot",
  "realm.interrupt",
] as const;
export type RealmRequestMethod = (typeof realmRequestMethods)[number];

/** True for the methods `Realm.handle` answers. */
export function isRealmRequest(method: string): method is RealmRequestMethod {
  return realmRequestMethods.some((known) => known === method);
}

/** Zod `parse` at the boundary (08-code-standards §5); a failure is core's InvalidParams, so the host answers -32602. */
export function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const parsed = schema.safeParse(params);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
  throw new InvalidParams({ issues });
}
