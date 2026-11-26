// The keybindings commands: the bindings in effect, set a command's keys in the user's or the
// workspace's keybindings.json, reset them, and the files as text for the page's Keyboard Shortcuts (JSON).
import { z } from "zod";

import { keybindingFilesSchema, keybindingSourceSchema } from "../model/keybinding.js";
import { whenContextKeys } from "../settings/keybindingWhen.js";
import { defineCommand } from "./define.js";

const scope = z.enum(["user", "workspace"]);
const args = z.record(z.string(), z.unknown());

const binding = z.object({
  key: z
    .string()
    .describe("The keys as keybindings.json writes them: cmd+shift+p, cmd+k cmd+s, escape"),
  command: z.string(),
  when: z.string().describe("The when clause; empty when the binding acts everywhere"),
  args: args.optional(),
  source: keybindingSourceSchema,
  conflicts: z
    .array(z.string())
    .describe(
      "Other commands bound to the same key where this one is, which one of the two shadows",
    ),
});

const problem = z.object({ file: scope, index: z.number().int(), message: z.string() });

const listOutput = z.object({
  keybindings: z.array(binding),
  problems: z.array(problem).describe("Rules of the files that could not be read, left out"),
});

export const keybindingsList = defineCommand({
  name: "keybindings.list",
  description:
    "The keybindings in effect: the defaults, then the user's keybindings.json, then the workspace's (.jsnb/keybindings.json), as VS Code's; each with its when clause, the file it comes from and the commands it conflicts with. Filter by command, key (cmd+k, as written in the file) or source.",
  input: z.object({
    command: z.string().optional(),
    key: z.string().optional(),
    source: keybindingSourceSchema.optional(),
  }),
  output: listOutput,
});

const target = {
  command: z.string().min(1).describe("The command id, as keybindings.list names it"),
  args: args.optional().describe("The command's arguments, for a command bound once per argument"),
  when: z
    .string()
    .optional()
    .describe(
      `The when clause (${whenContextKeys.join(", ")}, each maybe negated with !, joined by &&); by default the one the command's bindings have`,
    ),
};

export const keybindingsSet = defineCommand({
  name: "keybindings.set",
  description:
    "Give a command exactly these keys (an empty list, or `--keys ''` on the command line, unbinds it) by writing the user's keybindings.json (the default) or the workspace's, as VS Code's Keyboard Shortcuts editor does: removals of the keys it had, bindings of the new ones. Keys as cmd+shift+r, a chord as cmd+k cmd+r. Applies at once in every open page.",
  input: z.object({ ...target, keys: z.array(z.string()), scope: scope.default("user") }),
  output: listOutput,
  tags: { mutating: true, idempotent: true },
});

export const keybindingsReset = defineCommand({
  name: "keybindings.reset",
  description:
    "Remove what the user's keybindings.json, the workspace's or both (no scope) say about a command, so its keys are the defaults again; with no when or args, every binding of the command.",
  input: z.object({ ...target, scope: scope.optional() }),
  output: listOutput,
  tags: { mutating: true, idempotent: true },
});

export const keybindingsRules = defineCommand({
  name: "keybindings.rules",
  description:
    "Called by the page: the rules of the two keybindings files, which it applies over the defaults.",
  input: z.object({}),
  output: keybindingFilesSchema,
  tags: { internal: true },
});

export const keybindingsFile = defineCommand({
  name: "keybindings.file",
  description:
    "Called by the page's Keyboard Shortcuts (JSON): the user or workspace keybindings file as text, empty when it does not exist.",
  input: z.object({ scope }),
  output: z.object({ path: z.string(), text: z.string() }),
  tags: { internal: true },
});

export const keybindingsWriteFile = defineCommand({
  name: "keybindings.writeFile",
  description:
    "Called by the page's Keyboard Shortcuts (JSON): the keybindings file replaced by `text` (JSONC, a list of rules), applied at once.",
  input: z.object({ scope, text: z.string() }),
  output: z.object({}),
  tags: { internal: true, mutating: true },
});
