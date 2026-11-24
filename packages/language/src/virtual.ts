// A cell's virtual file: one generated line that imports what the cell sees, the cell's
// source untouched, and a generated last line that exports its own names. A position in the cell is the same
// character one line down; an offset in the cell is the prefix's length further.
import type { CellId, CellPosition, CellRange } from "@jsnb/core";

import type { CellDeclarations } from "./declarations.js";
import type { Realm, Visibility } from "./visibility.js";

/** A bridge declaration in a client cell's prefix: where its name is, and where the server export's name is. */
type BridgeLink = {
  readonly name: string;
  /** Offset of the declared name in the virtual file. */
  readonly declared: number;
  /** Offset of the server export's name after `import("…").`, in the virtual file. */
  readonly target: number;
  readonly provider: CellId;
};

export type VirtualCell = {
  readonly id: CellId;
  readonly realm: Realm;
  readonly source: string;
  readonly fileName: string;
  readonly text: string;
  /** Length of the generated first line, its line break included: where the cell's source starts. */
  readonly start: number;
  readonly links: readonly BridgeLink[];
  readonly lines: readonly number[];
  /** The element kind of each name the prefix imports from another cell, as its provider declares it. */
  readonly importedKinds: ReadonlyMap<string, string>;
};

/** FNV-1a over UTF-16 units, base36: the notebook's short key in its cells' file names. */
export function notebookKey(ref: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < ref.length; i += 1) {
    hash ^= ref.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export const cellFileName = (root: string, key: string, cell: CellId): string =>
  `${root}/__nimbo_${key}_${cell}.ts`;

const baseName = (fileName: string): string => fileName.slice(fileName.lastIndexOf("/") + 1);

/** The cell's top-level names its own exports do not already export, as the generated last line. */
function suffix(declarations: CellDeclarations): string {
  const names = [...declarations.names.keys()].filter(
    (name) => !declarations.exportNames.has(name),
  );
  return `export { ${names.join(", ")} };`;
}

/** Line starts of `text`: `\r\n`, `\r` and `\n` each end a line. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i);
    if (char === 13 && text.charCodeAt(i + 1) === 10) i += 1;
    if (char === 13 || char === 10) starts.push(i + 1);
  }
  return starts;
}

type Inputs = {
  readonly id: CellId;
  readonly realm: Realm;
  readonly source: string;
  readonly declarations: CellDeclarations;
  readonly visibility: Visibility;
  readonly fileOf: (cell: CellId) => string;
  /** A cell's element kind for a name it declares. */
  readonly kindIn: (cell: CellId, name: string) => string | undefined;
};

/** The generated first line, without its line break, and the bridge declarations' links in it. */
function prefixLine(inputs: Inputs): { text: string; links: BridgeLink[] } {
  const { visibility: seen, fileOf } = inputs;
  const spec = (cell: CellId): string => JSON.stringify(`./${baseName(fileOf(cell))}`);
  let text = "";
  for (const [cell, names] of seen.imports)
    text += `import { ${names.join(", ")} } from ${spec(cell)};`;
  if (seen.builtins.length > 0)
    text += `import { ${seen.builtins.join(", ")} } from "nimbo:${inputs.realm}";`;
  const links: BridgeLink[] = [];
  /** Appends `head name middle name tail`, linking the first name to the second. */
  const declare = (
    [head, middle, tail]: readonly [string, string, string],
    name: string,
    provider: CellId,
  ): void => {
    const declared = text.length + head.length;
    links.push({ name, provider, declared, target: declared + name.length + middle.length });
    text += `${head}${name}${middle}${name}${tail}`;
  };
  for (const { name, provider, kind } of seen.bridge) {
    const target = `import(${spec(provider)}).`;
    if (kind !== "type")
      declare(
        ["declare const ", `: import("nimbo:bridge").Remote<typeof ${target}`, ">;"],
        name,
        provider,
      );
    if (kind !== "value") declare(["type ", ` = ${target}`, ";"], name, provider);
  }
  return { text, links };
}

/** The element kind of each name the prefix imports, as its provider declares it (an import stays an alias). */
function importedKinds(inputs: Inputs): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const [cell, names] of inputs.visibility.imports) {
    for (const name of names) {
      const kind = inputs.kindIn(cell, name);
      if (kind && kind !== "alias") kinds.set(name, kind);
    }
  }
  return kinds;
}

/** The virtual file of one cell. */
export function virtualCell(inputs: Inputs): VirtualCell {
  const prefix = prefixLine(inputs);
  return {
    id: inputs.id,
    realm: inputs.realm,
    source: inputs.source,
    fileName: inputs.fileOf(inputs.id),
    text: `${prefix.text}\n${inputs.source}\n${suffix(inputs.declarations)}`,
    start: prefix.text.length + 1,
    links: prefix.links,
    lines: lineStarts(inputs.source),
    importedKinds: importedKinds(inputs),
  };
}

/** The offset in the cell's source of a position, clamped to the source. */
export function offsetOf(cell: VirtualCell, at: CellPosition): number {
  const start = cell.lines[at.line];
  if (start === undefined) return cell.source.length;
  const next = cell.lines[at.line + 1] ?? cell.source.length + 1;
  return Math.min(start + at.character, next - 1, cell.source.length);
}

/** The position of an offset in the cell's source. */
function positionOf(cell: VirtualCell, offset: number): CellPosition {
  const clamped = Math.max(0, Math.min(offset, cell.source.length));
  let low = 0;
  let high = cell.lines.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((cell.lines[mid] ?? 0) <= clamped) low = mid;
    else high = mid - 1;
  }
  return { line: low, character: clamped - (cell.lines[low] ?? 0) };
}

export const rangeOf = (cell: VirtualCell, start: number, end: number): CellRange => ({
  start: positionOf(cell, start),
  end: positionOf(cell, end),
});

/** True when a virtual-file offset falls in the cell's own source (its end included). */
export const inSource = (cell: VirtualCell, offset: number): boolean =>
  offset >= cell.start && offset <= cell.start + cell.source.length;
