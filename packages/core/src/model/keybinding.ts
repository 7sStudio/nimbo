// The wire shape of keybindings: a rule as keybindings.json holds it, VS Code's
// format (`{ "key": "cmd+k cmd+s", "command": "ui.shortcuts.open", "when": "notebook" }`, a command starting with `-`
// removing an earlier binding), and one binding in effect with the file it comes from.
import { z } from "zod";

export const keybindingRuleSchema = z.object({
  /** The keys as written, `cmd+shift+p`, a chord's two parts apart (`cmd+k cmd+s`); optional on a removal only. */
  key: z.string().optional(),
  /** The command id; `-id` removes the bindings of `id` that match the rule's key, when and args. */
  command: z.string().min(1),
  /** A when clause over the context keys (`notebook && commandMode`); none means everywhere. */
  when: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type KeybindingRule = z.infer<typeof keybindingRuleSchema>;

export const keybindingSourceSchema = z.enum(["default", "user", "workspace"]);
export type KeybindingSource = z.infer<typeof keybindingSourceSchema>;

/** The rules of the two files, as the keybindings.changed event and keybindings.rules carry them. */
export const keybindingFilesSchema = z.object({
  user: z.array(keybindingRuleSchema).readonly(),
  workspace: z.array(keybindingRuleSchema).readonly(),
});
export type KeybindingFiles = z.infer<typeof keybindingFilesSchema>;
