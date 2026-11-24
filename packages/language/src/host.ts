// The TypeScript service host over a notebook's virtual files and the workspace on disk.
// Cell files and the built-in declarations live in memory; everything else is read from disk, versioned by mtime
// outside node_modules (an edited ./lib/prices.ts is seen) and constant inside it.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import ts from "typescript";

import type { Realm } from "./visibility.js";

/** In-memory files: the cells' virtual files and the built-in declarations, each with a version bumped on change. */
export type MemoryFiles = {
  readonly get: (
    fileName: string,
  ) => { readonly text: string; readonly version: number } | undefined;
  readonly set: (fileName: string, text: string) => void;
  readonly delete: (fileName: string) => void;
};

export function createMemoryFiles(): MemoryFiles {
  const files = new Map<string, { text: string; version: number }>();
  let clock = 0;
  return {
    get: (fileName) => files.get(fileName),
    set: (fileName, text) => {
      const current = files.get(fileName);
      if (current?.text === text) return;
      clock += 1;
      files.set(fileName, { text, version: clock });
    },
    delete: (fileName) => {
      files.delete(fileName);
    },
  };
}

/** `<dir>/node_modules/@types` for the workspace folder and each of its parents that has one. */
function workspaceTypeRoots(root: string): string[] {
  const roots: string[] = [];
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", "@types");
    if (existsSync(candidate)) roots.push(candidate);
    if (dirname(dir) === dir) return roots;
  }
}

/** The compiler options of §3.3 for a realm. */
export function compilerOptions(
  realm: Realm,
  root: string,
  fallbackTypeRoots: readonly string[],
): ts.CompilerOptions {
  const shared: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
    noImplicitAny: false,
    skipLibCheck: true,
    allowJs: true,
    checkJs: false,
    resolveJsonModule: true,
    esModuleInterop: true,
    typeRoots: [...workspaceTypeRoots(root), ...fallbackTypeRoots],
  };
  return realm === "server"
    ? { ...shared, lib: ["lib.esnext.d.ts"], types: ["node"] }
    : { ...shared, lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], types: [] };
}

const insideNodeModules = (fileName: string): boolean => fileName.includes("/node_modules/");

/** Snapshots of files on disk, read again when their version changes. */
function diskReader(libFolder: string) {
  const cache = new Map<string, { version: string; snapshot: ts.IScriptSnapshot }>();
  const version = (fileName: string): string =>
    insideNodeModules(fileName) || fileName.startsWith(libFolder)
      ? "0"
      : String(ts.sys.getModifiedTime?.(fileName)?.getTime() ?? 0);
  const snapshot = (fileName: string): ts.IScriptSnapshot | undefined => {
    const current = version(fileName);
    const cached = cache.get(fileName);
    if (cached?.version === current) return cached.snapshot;
    const text = ts.sys.readFile(fileName);
    if (text === undefined) return undefined;
    const fresh = ts.ScriptSnapshot.fromString(text);
    cache.set(fileName, { version: current, snapshot: fresh });
    return fresh;
  };
  return { version, snapshot };
}

/** A language service host for one realm: its root files, the shared memory files, the workspace on disk. */
export function createHost(options: {
  readonly root: string;
  readonly compilerOptions: ts.CompilerOptions;
  readonly memory: MemoryFiles;
  readonly rootFiles: () => readonly string[];
}): ts.LanguageServiceHost {
  const { memory } = options;
  const disk = diskReader(dirname(ts.getDefaultLibFilePath(options.compilerOptions)));
  return {
    getCompilationSettings: () => options.compilerOptions,
    getScriptFileNames: () => [...options.rootFiles()],
    getScriptVersion: (fileName) =>
      String(memory.get(fileName)?.version ?? `disk:${disk.version(fileName)}`),
    getScriptSnapshot: (fileName) => {
      const inMemory = memory.get(fileName);
      return inMemory ? ts.ScriptSnapshot.fromString(inMemory.text) : disk.snapshot(fileName);
    },
    getCurrentDirectory: () => options.root,
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: (fileName) => memory.get(fileName) !== undefined || ts.sys.fileExists(fileName),
    readFile: (fileName, encoding) =>
      memory.get(fileName)?.text ?? ts.sys.readFile(fileName, encoding),
    readDirectory: (...args) => ts.sys.readDirectory(...args),
    directoryExists: (dir) => ts.sys.directoryExists(dir),
    getDirectories: (dir) => ts.sys.getDirectories(dir),
    realpath: (path) => (memory.get(path) ? path : (ts.sys.realpath?.(path) ?? path)),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };
}
