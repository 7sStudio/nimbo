// Tests how the page takes the shared tokens: main.css imports @jsnb/tokens' page sheet before the page's own tokens.css,
// which redefines none of them (so the page and the output viewer can never show two palettes), and index.html marks the
// document as one that declares them, so a viewer inside it reads the page's instead of declaring its own.
import { readFileSync } from "node:fs";

import { colors, valueGroups } from "@jsnb/tokens";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const shared = new Set([
  ...Object.keys(colors),
  ...valueGroups.flatMap((group) => Object.keys(group.values)),
]);

describe("the page's tokens", () => {
  it("imports the shared sheet before its own tokens", () => {
    const main = read("../main.css");
    const page = main.indexOf('@import "@jsnb/tokens/page.css";');
    expect(page).toBeGreaterThan(-1);
    expect(main.indexOf('@import "./theme/tokens.css";')).toBeGreaterThan(page);
  });

  it("redefines no shared token in tokens.css", () => {
    const declared = [...read("tokens.css").matchAll(/^\s*--([a-z0-9-]+):/gmu)].map(
      ([, name]) => name,
    );
    expect(declared.length).toBeGreaterThan(30);
    expect(declared.filter((name) => shared.has(name ?? ""))).toEqual([
      // the focused header's deeper ink, an override of four shared tokens inside that header alone
      "muted",
      "hot",
      "err",
      "ok",
    ]);
  });

  it("marks the document as one that declares them, for the output viewers inside it", () => {
    expect(read("../../index.html")).toMatch(/<html lang="en" data-jsnb-tokens>/u);
  });
});
