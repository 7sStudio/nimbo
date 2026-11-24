// The published build, checked after `pnpm build`: core is private and bundled in, so no JavaScript or
// declaration file under dist imports an @jsnb package, package.json lists none to install, the source maps name no
// file outside the package and carry every source's text (core's bundled code included), and dist/model runs in plain
// Node (the model has no DOM and no Vue).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

/** Every file under `dir`, recursively. */
const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)],
  );

/** The module specifiers a file names: static and dynamic imports, re-exports, and declaration import() types. */
const specifiers = (text: string): string[] =>
  [
    ...text.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...text.matchAll(/\bimport\s*["']([^"']+)["']/g),
  ].map((match) => match[1] ?? "");

/** What is wrong with the source map `file`: a source outside the package, or one without its text. */
function mapFindings(file: string): string[] {
  const map: unknown = JSON.parse(readFileSync(file, "utf8"));
  const field = (name: string): unknown[] => {
    const value: unknown = typeof map === "object" && map !== null ? Reflect.get(map, name) : [];
    return Array.isArray(value) ? value : [];
  };
  const contents = field("sourcesContent");
  return field("sources").flatMap((source, index) => {
    const path = typeof source === "string" ? relative(root, resolve(dirname(file), source)) : "";
    const name = `${file.slice(dist.length + 1)} → ${String(source)}`;
    return [
      ...(path === "" || path.startsWith("..") ? [`${name}: outside the package`] : []),
      ...(typeof contents[index] === "string" ? [] : [`${name}: no sourcesContent`]),
    ];
  });
}

/** The packages package.json has installed with this one: its dependencies and peer dependencies. */
function installed(): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return ["dependencies", "peerDependencies"].flatMap((field) => {
    const deps: unknown =
      typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, field) : {};
    return typeof deps === "object" && deps !== null ? Object.keys(deps) : [];
  });
}

describe("output-view's dist", () => {
  it("exists: the contract stage runs after the build", () => {
    expect(existsSync(join(dist, "index.js")), "run `pnpm build` first").toBe(true);
  });

  it("imports no @jsnb package from any JavaScript or declaration file", () => {
    const files = filesIn(dist).filter((file) => /\.(js|d\.ts)$/.test(file));
    expect(files.map((file) => file.slice(dist.length + 1))).toEqual(
      expect.arrayContaining(["index.js", "index.d.ts", "model/index.js", "model/index.d.ts"]),
    );
    const named = files.flatMap((file) =>
      specifiers(readFileSync(file, "utf8"))
        .filter((specifier) => specifier.startsWith("@jsnb/"))
        .map((specifier) => `${file.slice(dist.length + 1)} → ${specifier}`),
    );
    expect(named).toEqual([]);
  });

  it("maps every bundled source to a path inside the package, with its text", () => {
    const maps = filesIn(dist).filter((file) => file.endsWith(".map"));
    expect(maps.map((file) => file.slice(dist.length + 1))).toContain("index.js.map");
    expect(maps.flatMap(mapFindings)).toEqual([]);
  });

  it("lists no @jsnb package as a dependency or peer dependency", () => {
    expect(installed().filter((name) => name.startsWith("@jsnb/"))).toEqual([]);
  });

  it("runs its model in plain Node, with no window or document", () => {
    const model = pathToFileURL(join(dist, "model", "index.js")).href;
    const script = `const m = await import(${JSON.stringify(model)});
const out = m.toOutput({ kind: "value", json: { id: 1 }, repr: "" });
console.log(typeof window, typeof document, out.kind, typeof m.flatten);`;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect([run.status, run.stderr]).toEqual([0, ""]);
    expect(run.stdout.trim()).toBe("undefined undefined value function");
  });
});
