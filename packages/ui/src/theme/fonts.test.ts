// The bundled fonts: every file fonts.css names is a woff2 in the repository, beside its licence, and
// nothing is fetched from the network.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = (name: string): string => fileURLToPath(new URL(name, import.meta.url));
const css = readFileSync(here("./fonts.css"), "utf8");
const sources = [...css.matchAll(/url\("([^"]+)"\)/gu)].map(([, url = ""]) => url);

describe("fonts.css", () => {
  it("declares Geist and JetBrains Mono, swapped in", () => {
    const families = [...css.matchAll(/font-family: ([^;]+);/gu)].map(([, name]) => name);
    expect(new Set(families)).toEqual(new Set(["Geist", '"JetBrains Mono"']));
    expect(css.match(/font-display: swap;/gu)).toHaveLength(families.length);
  });

  it("names only local woff2 files, each one present and a woff2", () => {
    expect(sources.length).toBe(3);
    for (const source of sources) {
      expect(source).toMatch(/^\.\/fonts\/[\w-]+\.woff2$/u);
      expect(readFileSync(here(source)).subarray(0, 4).toString("latin1")).toBe("wOF2");
    }
  });

  it("keeps the SIL Open Font License of both families beside them", () => {
    for (const licence of ["./fonts/OFL-geist.txt", "./fonts/OFL-jetbrains-mono.txt"]) {
      expect(readFileSync(here(licence), "utf8")).toContain("SIL Open Font License");
    }
  });
});
