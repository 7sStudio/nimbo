// Tests __import and require with Node's own import() over real workspaces: workspace paths busted
// by mtime (the module sees the busted URL), file: URLs as they are, bare specifiers through the workspace loader
// (imported once), a loader without `load` refused, a loader that failed to import asked for again, require from the
// workspace's package.json. One stub, named as one: a load whose continuation an interrupt cleared, which only a real
// termination produces (it would end the test's own code).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { constants, runInThisContext } from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import { LoaderInvalid } from "./errors.js";
import { createImport, createWorkspaceRequire, pathUrl } from "./imports.js";

type Load = (url: string) => Promise<unknown>;
const isLoad = (value: unknown): value is Load => typeof value === "function";

/** Node's own import(), as the kernel calls it, compiled outside Vitest's module runner, which loads the test's. */
function nativeImportOf(): Load {
  const compiled: unknown = runInThisContext("(url) => import(url)", {
    importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  if (!isLoad(compiled)) throw new Error("no native import()");
  return compiled;
}

const nativeImport = nativeImportOf();

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

/** Writes `text` to `name` in `workspace`. */
function workspaceFile(workspace: string, name: string, text: string): void {
  mkdirSync(dirname(join(workspace, name)), { recursive: true });
  writeFileSync(join(workspace, name), text);
}

/** A fresh workspace (its real path, as Node reports module URLs) with `files` written. */
function workspaceWith(files: Readonly<Record<string, string>>): string {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "nimbo-imports-")));
  workspaces.push(workspace);
  for (const [name, text] of Object.entries(files)) workspaceFile(workspace, name, text);
  return workspace;
}

const whereModule = { "lib/where.mjs": "export const url = import.meta.url;\n" };
const recordingLoader = {
  ".jsnb/loader.mjs": [
    "export const asked = [];",
    "export const load = (specifier) => (asked.push(specifier), import(specifier));",
  ].join("\n"),
};

/** Node's import(), each URL it is asked for recorded. */
function realLoad() {
  const urls: string[] = [];
  const load = (url: string): Promise<unknown> => {
    urls.push(url);
    return nativeImport(url);
  };
  return { urls, load };
}

describe("pathUrl and path specifiers", () => {
  it("import a workspace file under its mtime-busted URL; an absent file stays unbusted", async () => {
    const workspace = workspaceWith(whereModule);
    const file = pathToFileURL(join(workspace, "lib", "where.mjs")).href;
    const mtime = statSync(join(workspace, "lib", "where.mjs")).mtimeMs;
    const busted = `${file}?v=${String(mtime)}`;
    expect(pathUrl(workspace, "./lib/where.mjs")).toBe(busted);
    const importer = createImport({ workspace, load: realLoad().load });
    expect(await importer("./lib/where.mjs")).toMatchObject({ url: busted });
    expect(await importer(join(workspace, "lib", "where.mjs"))).toMatchObject({ url: busted });
    const missing = pathToFileURL(join(workspace, "lib", "missing.mjs")).href;
    await expect(importer("./lib/missing.mjs")).rejects.toMatchObject({
      code: "ERR_MODULE_NOT_FOUND",
      url: missing,
    });
  });

  it("import a file: URL as it is", async () => {
    const workspace = workspaceWith(whereModule);
    const url = pathToFileURL(join(workspace, "lib", "where.mjs")).href;
    expect(await createImport({ workspace, load: realLoad().load })(url)).toMatchObject({ url });
  });
});

describe("bare specifiers", () => {
  it("go through the workspace loader, imported once", async () => {
    const workspace = workspaceWith(recordingLoader);
    const { urls, load } = realLoad();
    const importer = createImport({ workspace, load });
    expect(await importer("node:path")).toHaveProperty("sep");
    expect(await importer("node:os")).toHaveProperty("tmpdir");
    const loaderUrl = pathToFileURL(join(workspace, ".jsnb", "loader.mjs")).href;
    expect(urls).toEqual([loaderUrl]);
    expect(await nativeImport(loaderUrl)).toMatchObject({ asked: ["node:path", "node:os"] });
  });

  it("refuse a loader without load, and ask again for a loader that failed to import", async () => {
    const workspace = workspaceWith({});
    const importer = createImport({ workspace, load: realLoad().load });
    await expect(importer("node:path")).rejects.toMatchObject({ code: "ERR_MODULE_NOT_FOUND" });
    workspaceFile(workspace, ".jsnb/loader.mjs", "export const nothing = 1;\n");
    await expect(importer("node:path")).rejects.toThrow(LoaderInvalid);
  });
});

describe("bare specifiers after a load that never ended (stub: an interrupt's cleared continuation)", () => {
  it("ask for the loader again instead of waiting on the load an interrupt cut short", async () => {
    const workspace = workspaceWith(recordingLoader);
    const { urls, load } = realLoad();
    let first = true;
    const cutShort = (url: string): Promise<unknown> => {
      if (!first) return load(url);
      first = false;
      return new Promise<never>(() => undefined); // stub: never settles, like a continuation a terminate cleared
    };
    const importer = createImport({ workspace, load: cutShort });
    void importer("node:os");
    expect(await importer("node:path")).toHaveProperty("sep");
    expect(urls).toHaveLength(1);
  });
});

describe("createWorkspaceRequire", () => {
  it("requires CommonJS packages from the workspace's node_modules", () => {
    const workspace = workspaceWith({
      "node_modules/tiny/package.json": '{ "name": "tiny", "main": "index.js" }',
      "node_modules/tiny/index.js": "module.exports = { tiny: true };\n",
    });
    expect(createWorkspaceRequire(workspace)("tiny")).toEqual({ tiny: true });
  });
});
