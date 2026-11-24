// The messages between the daemon and its language worker. Every request carries the
// notebook's cells as the daemon holds them (with a socket's open documents laid over them), so the worker never holds
// state the daemon could not rebuild after a restart.
import type { CellId, CellPosition } from "@jsnb/core";
import type { EnvNames, LanguageCell } from "@jsnb/language";

export type Snapshot = {
  readonly notebook: string;
  readonly cells: readonly LanguageCell[];
  readonly env: EnvNames;
};

export type QueryName = "completions" | "hover" | "signature" | "definition";

export type WorkerTask =
  | { readonly op: "diagnostics"; readonly snapshot: Snapshot; readonly cell?: CellId }
  | {
      readonly op: "query";
      readonly snapshot: Snapshot;
      readonly query: QueryName;
      readonly cell: CellId;
      readonly position: CellPosition;
    }
  | {
      readonly op: "rename";
      readonly snapshot: Snapshot;
      readonly cell: CellId;
      readonly position: CellPosition;
      readonly newName: string;
    }
  | { readonly op: "close"; readonly notebook: string }
  /** After an install: every project is built again, so module resolution and package types are read afresh. */
  | { readonly op: "reset" };

export type WorkerRequest = WorkerTask & { readonly id: number };

export type WorkerReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly message: string };

/** What the worker is started with. */
export type WorkerData = { readonly root: string; readonly fallbackTypeRoots: readonly string[] };
