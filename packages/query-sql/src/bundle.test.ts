// The page bundle carries no DuckDB and no Arrow: from index.ts, the static imports reach
// neither package nor any ?url asset, and duckdb/ and node/ are reached only through import().
import { describe, expect, it } from "vitest";

const sources: Record<string, string> = import.meta.glob(
  ["./**/*.ts", "!./**/*.test.ts", "!./fixtures/**"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

const staticImport = /^\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gmu;
const dynamicImport = /import\(\s*["']([^"']+)["']\s*\)/gu;

const resolve = (from: string, specifier: string): string => {
  const url = new URL(specifier, `file:///root/${from.slice(2)}`);
  return `.${url.pathname.slice("/root".length)}${specifier.endsWith(".ts") ? "" : ".ts"}`;
};

/** The modules index.ts reaches through value imports, and every specifier they name. */
function closure(entry: string) {
  const seen = new Set<string>();
  const specifiers = new Set<string>();
  const dynamic = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = sources[file] ?? "";
    for (const [, specifier = ""] of text.matchAll(staticImport)) {
      specifiers.add(specifier);
      if (specifier.startsWith(".")) visit(resolve(file, specifier));
    }
    for (const [, specifier = ""] of text.matchAll(dynamicImport))
      dynamic.add(resolve(file, specifier));
  };
  visit(entry);
  return { seen, specifiers, dynamic };
}

describe("page bundle", () => {
  const { seen, specifiers, dynamic } = closure("./index.ts");

  it("reads the sources it checks", () => {
    expect(Object.keys(sources)).toContain("./duckdb/database.ts");
    expect(seen).toContain("./lifecycle.ts");
    expect([...seen].every((file) => file in sources)).toBe(true);
  });

  it("imports neither DuckDB nor Arrow nor an asset URL statically", () => {
    const outside = [...specifiers].filter((specifier) => !specifier.startsWith("."));
    expect(outside).toEqual([]);
    expect([...specifiers].filter((specifier) => specifier.includes("?url"))).toEqual([]);
  });

  it("reaches duckdb/ only through import(), and never node/", () => {
    expect(
      [...seen].filter((file) => file.startsWith("./duckdb/") || file.startsWith("./node/")),
    ).toEqual([]);
    expect([...dynamic]).toEqual(["./duckdb/database.ts"]);
    const lazy = closure("./duckdb/database.ts");
    expect([...lazy.specifiers]).toContain("@duckdb/duckdb-wasm");
    expect([...lazy.seen].filter((file) => file.startsWith("./node/"))).toEqual([]);
  });
});
