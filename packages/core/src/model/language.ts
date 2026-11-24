// The language service's wire shapes: positions in a cell's source and its diagnostics.
import { z } from "zod";

import { CellId } from "./ids.js";

const count = z.number().int().nonnegative();

/** 0-based line and UTF-16 character in a cell's source, the same on both sides whatever the line endings. */
export const CellPosition = z.object({ line: count, character: count }).readonly();
export type CellPosition = z.infer<typeof CellPosition>;

export const CellRange = z.object({ start: CellPosition, end: CellPosition }).readonly();
export type CellRange = z.infer<typeof CellRange>;

export const DiagnosticSeverity = z.enum(["error", "warning"]);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeverity>;

/** `source` is `ts` for TypeScript's checks, `nimbo` for the transform's refusals. */
export const Diagnostic = z
  .object({
    range: CellRange,
    severity: DiagnosticSeverity,
    code: z.union([z.number().int(), z.string()]),
    message: z.string(),
    source: z.enum(["ts", "nimbo"]),
  })
  .readonly();
export type Diagnostic = z.infer<typeof Diagnostic>;

export const CellDiagnostics = z
  .object({ cell: CellId, diagnostics: z.array(Diagnostic).readonly() })
  .readonly();
export type CellDiagnostics = z.infer<typeof CellDiagnostics>;

/**
 * One name a server cell exports, as the page can call it over the bridge (notebook.bridge): its cell, TypeScript's
 * signature of it as the hover shows it (null while the language service is off or reads none), its JSDoc as markdown,
 * and the client cells that use it.
 */
export const BridgeExport = z
  .object({
    name: z.string(),
    cell: CellId,
    signature: z.string().nullable(),
    documentation: z.string(),
    callers: z.array(CellId).readonly(),
  })
  .readonly();
export type BridgeExport = z.infer<typeof BridgeExport>;
