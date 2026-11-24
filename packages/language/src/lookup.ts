// What the queries and rename read of a project: its cells' virtual files and the realm's language service.
import type { CellId } from "@jsnb/core";
import type ts from "typescript";

import type { VirtualCell } from "./virtual.js";
import type { Realm } from "./visibility.js";

export type Lookup = {
  readonly root: string;
  readonly cell: (id: CellId) => VirtualCell | undefined;
  readonly file: (fileName: string) => VirtualCell | undefined;
  readonly cells: () => readonly VirtualCell[];
  readonly service: (realm: Realm) => ts.LanguageService;
};

/** The cell and the virtual-file offset of a position in it, or undefined for a cell the project has no file for. */
export type At = { readonly cell: VirtualCell; readonly offset: number };
