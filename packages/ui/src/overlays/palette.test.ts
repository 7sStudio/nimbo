// The palette's order and its read toast: what cannot run with its arguments is left out, the recently
// used commands come first in their order, the others keep the catalogue's; a long answer is cut to one line.
import { describe, expect, it } from "vitest";

import type { Command } from "../commands/command.js";
import { answerLine, paletteCatalogue, shownEntries } from "./palette.js";

const command = (id: string, source: Command["source"], when?: Command["when"]): Command => ({
  id,
  title: id,
  source,
  run: () => undefined,
  ...(when === undefined ? {} : { when }),
});

describe("the palette's entries", () => {
  const commands = [
    command("ui.panel.open", "ui"),
    command("ui.escape", "ui"),
    command("notebook.run", "registry", (args) => args?.select !== undefined),
    command("kernel.status", "registry"),
  ];
  const catalogue = paletteCatalogue(commands);

  it("put the variants and the page's commands before the registry's, without the plumbing", () => {
    expect(catalogue.map((entry) => entry.title).slice(0, 2)).toEqual([
      "Run All",
      "Run Stale Cells",
    ]);
    expect(catalogue.map((entry) => entry.command)).not.toContain("ui.escape");
    expect(catalogue.at(-1)?.command).toBe("kernel.status");
  });

  it("show what can run, the recently used first", () => {
    const find = (id: string) => commands.find((each) => each.id === id);
    const shown = shownEntries(catalogue, find, ["kernel.status", "notebook.run"]);
    expect(shown.map((entry) => entry.title).slice(0, 3)).toEqual([
      "kernel.status",
      "Run All",
      "Run Stale Cells",
    ]);
    // notebook.run without a selection cannot run
    expect(shown.filter((entry) => entry.key === "notebook.run")).toEqual([]);
  });

  it("cut a long answer to one line", () => {
    expect(answerLine({ a: 1 })).toBe('{"a":1}');
    const long = answerLine({ text: "x".repeat(400) });
    expect(long).toHaveLength(240);
    expect(long.endsWith("…")).toBe(true);
    expect(answerLine(undefined)).toBe("");
  });
});
