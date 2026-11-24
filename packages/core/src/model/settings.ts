// The wire shape of one resolved setting (03-api §4.10), in settings.get and the settings.changed event: the effective
// value, the file it comes from, and what the user and the workspace file each set (absent when that file does not).
import { z } from "zod";

export const resolvedValueSchema = z.object({
  value: z.unknown(),
  source: z.enum(["default", "user", "workspace"]),
  user: z.unknown().optional(),
  workspace: z.unknown().optional(),
});
