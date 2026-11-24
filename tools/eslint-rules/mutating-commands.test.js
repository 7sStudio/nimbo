// The rule's list of mutating and destructive commands is exactly core's registry's.
import { commands } from "@jsnb/core";
import { expect, it } from "vitest";

import { mutatingCommands } from "./mutating-commands.js";

it("lists every command the registry tags mutating or destructive, and nothing else", () => {
  const tagged = commands
    .filter((command) => command.tags.mutating || command.tags.destructive)
    .map((command) => command.name)
    .sort();
  expect([...mutatingCommands].sort()).toEqual(tagged);
});
