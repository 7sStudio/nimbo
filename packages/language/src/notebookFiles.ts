// A notebook's virtual files: the cells' files rebuilt on each sync, the built-in
// declarations, and the two realms' language services over them, created on first use.
import type { CellId } from "@jsnb/core";
import ts from "typescript";

import { clientBuiltins, serverBuiltins } from "./builtins.js";
import type { CellDeclarations } from "./declarations.js";
import { scanDeclarations } from "./declarations.js";
import type { MemoryFiles } from "./host.js";
import { compilerOptions, createHost, createMemoryFiles } from "./host.js";
import type { Lookup } from "./lookup.js";
import type { LanguageCell } from "./types.js";
import type { VirtualCell } from "./virtual.js";
import { cellFileName, notebookKey, virtualCell } from "./virtual.js";
import type { Realm, ScannedCell } from "./visibility.js";
import { visibility } from "./visibility.js";

export type EnvNames = { readonly server: readonly string[]; readonly client: readonly string[] };

export type NotebookFiles = Lookup & {
  readonly sync: (cells: readonly LanguageCell[], env?: EnvNames) => void;
  readonly scanned: () => readonly ScannedCell[];
  readonly dispose: () => void;
};

/** One cell's top-level names, scanned again only when its source changed. */
function declarationCache() {
  const scans = new Map<CellId, { source: string; declarations: CellDeclarations }>();
  const of = (cell: LanguageCell): CellDeclarations => {
    const cached = scans.get(cell.id);
    if (cached?.source === cell.source) return cached.declarations;
    const declarations = scanDeclarations(cell.source);
    scans.set(cell.id, { source: cell.source, declarations });
    return declarations;
  };
  const keep = (ids: ReadonlySet<CellId>): void => {
    for (const id of scans.keys()) if (!ids.has(id)) scans.delete(id);
  };
  const kindIn = (id: CellId, name: string) => scans.get(id)?.declarations.elementKinds.get(name);
  return { of, keep, kindIn };
}

/** The two realms' language services over one document registry, each created on first use. */
function realmServices(options: {
  readonly root: string;
  readonly fallbackTypeRoots: readonly string[];
  readonly memory: MemoryFiles;
  readonly rootFiles: (realm: Realm) => string[];
}) {
  const { root, memory } = options;
  const registry = ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, root);
  const services = new Map<Realm, ts.LanguageService>();
  const service = (realm: Realm): ts.LanguageService => {
    const existing = services.get(realm);
    if (existing) return existing;
    const settings = compilerOptions(realm, root, options.fallbackTypeRoots);
    const rootFiles = () => options.rootFiles(realm);
    const created = ts.createLanguageService(
      createHost({ root, compilerOptions: settings, memory, rootFiles }),
      registry,
    );
    services.set(realm, created);
    return created;
  };
  const dispose = (): void => {
    for (const languageService of services.values()) languageService.dispose();
    services.clear();
  };
  return { service, dispose };
}

const builtinTexts = (env: EnvNames): [Realm, string][] => [
  ["server", serverBuiltins(env.server)],
  ["client", clientBuiltins(env.client)],
];

/** The scanned cells and their virtual files, for the notebook's code cells in document order. */
function buildCells(
  input: readonly LanguageCell[],
  scans: ReturnType<typeof declarationCache>,
  fileOf: (id: CellId) => string,
): { scanned: ScannedCell[]; cells: VirtualCell[] } {
  const scanned = input.map((cell) => ({
    id: cell.id,
    realm: cell.type,
    declarations: scans.of(cell),
  }));
  const cells = input.map((cell, index) =>
    virtualCell({
      ...{ id: cell.id, realm: cell.type, source: cell.source, fileOf, kindIn: scans.kindIn },
      declarations: scans.of(cell),
      visibility: visibility(scanned, index),
    }),
  );
  scans.keep(new Set(input.map((cell) => cell.id)));
  return { scanned, cells };
}

/** Writes the cells' files into memory, deletes those of cells gone, and returns the cells by file name. */
function writeCells(
  memory: MemoryFiles,
  previous: ReadonlyMap<string, VirtualCell>,
  cells: readonly VirtualCell[],
): Map<string, VirtualCell> {
  const byFile = new Map(cells.map((cell) => [cell.fileName, cell]));
  for (const fileName of previous.keys()) if (!byFile.has(fileName)) memory.delete(fileName);
  for (const cell of cells) memory.set(cell.fileName, cell.text);
  return byFile;
}

export function createNotebookFiles(options: {
  readonly root: string;
  readonly notebook: string;
  readonly fallbackTypeRoots: readonly string[];
}): NotebookFiles {
  const root = options.root.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const key = notebookKey(options.notebook);
  const builtinFile = (realm: Realm): string => `${root}/__jsnb_${key}_${realm}.d.ts`;
  const memory = createMemoryFiles();
  const scans = declarationCache();
  let cells: VirtualCell[] = [];
  let scanned: ScannedCell[] = [];
  let byFile = new Map<string, VirtualCell>();
  const setEnv = (env: EnvNames): void => {
    for (const [realm, text] of builtinTexts(env)) memory.set(builtinFile(realm), text);
  };
  setEnv({ server: [], client: [] });

  const rootFiles = (realm: Realm): string[] => [
    ...cells.filter((cell) => cell.realm === realm).map((cell) => cell.fileName),
    ...(realm === "client"
      ? [builtinFile("server"), builtinFile("client")]
      : [builtinFile("server")]),
  ];
  const services = realmServices({ ...options, root, memory, rootFiles });

  const sync = (input: readonly LanguageCell[], env?: EnvNames): void => {
    if (env) setEnv(env);
    ({ scanned, cells } = buildCells(input, scans, (id) => cellFileName(root, key, id)));
    byFile = writeCells(memory, byFile, cells);
  };

  return {
    root,
    cell: (id) => cells.find((cell) => cell.id === id),
    file: (fileName) => byFile.get(fileName),
    cells: () => cells,
    scanned: () => scanned,
    service: services.service,
    sync,
    dispose: services.dispose,
  };
}
