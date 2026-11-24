// Turns a Zod error into the ApiIssue list that INVALID_PARAMS and InvalidResponse carry (03-api §7.4, §7.6).
import type { ApiIssue } from "@jsnb/core";
import type { z } from "zod";

/** Every issue of `error` as its path and message. */
export function issuesOf(error: z.ZodError): readonly ApiIssue[] {
  return error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}
