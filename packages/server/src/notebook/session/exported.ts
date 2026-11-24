// cell.compare and notebook.export (03-api §4.2, §4.3): a cell's last run against the one before it, read with core's
// compareRuns, and the notebook as one HTML page built with output-view's model (07-file-format §9), its outputs the
// runs the session holds (saved ones included) through the daemon's redaction, written into the workspace on request.
import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import type { CellId } from "@jsnb/core";
import { cellName, compareRuns, Execution, InvalidParams } from "@jsnb/core";
import { notebookToHTML } from "@jsnb/output-view/model";
import type { NotebookHtmlCell } from "@jsnb/output-view/model";
import { marked } from "marked";

import { writeAtomically } from "../../files/atomicWrite.js";
import type { SessionContext } from "./context.js";
import { redactDeep } from "./fileForm.js";
import { terminalStatuses, toExecution } from "./records.js";

/** cell.compare: null comparison until the cell has a finished run and one before it. */
export function compareCell(context: SessionContext, cell: CellId, limit: number) {
  const record = context.cells.require(cell);
  const last = record.last && terminalStatuses.has(record.last.status) ? record.last : undefined;
  const current = last ?? record.previous;
  const previous = last ? record.previous : undefined;
  return {
    comparison:
      current !== undefined && previous !== undefined
        ? compareRuns(previous, current, limit)
        : null,
    previous: previous === undefined ? null : toExecution(previous),
    current: current === undefined ? null : toExecution(current),
  };
}

export type ExportRequest = {
  readonly outputs: boolean;
  readonly theme?: "light" | "dark" | undefined;
  readonly path?: string | undefined;
};

/** The notebook's cells as the export page takes them. */
function exportCells(
  context: SessionContext,
  outputs: boolean,
  redact: (text: string) => string,
): NotebookHtmlCell[] {
  return context.cells.list().map((record) => {
    const run =
      record.last && terminalStatuses.has(record.last.status) ? record.last : record.previous;
    const base = {
      id: record.id,
      type: record.type,
      source: redact(record.source),
      ...(record.type === "markdown" ? {} : { name: cellName(record, record.analysis, []) }),
    };
    if (!outputs || run === undefined || record.type === "markdown") return base;
    // a page's own outputs and saved runs pass the redaction again here
    const execution = Execution.parse(redactDeep(toExecution(run), redact));
    return {
      ...base,
      outputs: execution.outputs,
      status: execution.status,
      ...(execution.durationMs === undefined ? {} : { durationMs: execution.durationMs }),
      ...(execution.error === undefined ? {} : { error: execution.error }),
    };
  });
}

const outside = (path: string, message: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: ["path"], message: `${path}: ${message}` }] });

const inside = (from: string, to: string): boolean => {
  const rest = relative(from, to);
  return !rest.startsWith("..") && !isAbsolute(rest);
};

/** The real path of `path`'s nearest folder that exists. */
async function realAncestor(path: string): Promise<string> {
  const real = await realpath(path).catch(() => undefined);
  if (real !== undefined) return real;
  const up = dirname(path);
  return up === path ? path : realAncestor(up);
}

/** Where an export goes: an .html path inside the workspace, its folder made, never through a symbolic link. */
async function exportTarget(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || !path.endsWith(".html"))
    throw outside(path, "expected a relative .html path");
  const target = resolve(root, path);
  const realRoot = await realpath(root);
  if (!inside(root, target) || !inside(realRoot, await realAncestor(dirname(target))))
    throw outside(path, "leads outside the workspace");
  await mkdir(dirname(target), { recursive: true });
  if (!inside(realRoot, await realpath(dirname(target))))
    throw outside(path, "leads outside the workspace");
  const stats = await lstat(target).catch(() => undefined);
  if (stats?.isSymbolicLink() === true || stats?.isDirectory() === true)
    throw outside(path, "is a link or a folder");
  return target;
}

/** notebook.export: the page, and the workspace-relative path it was written to when `path` was given. */
export async function exportNotebook(
  context: SessionContext,
  request: ExportRequest,
  redact: (text: string) => string,
): Promise<{ html: string; path?: string }> {
  const title = basename(context.ref).replace(/\.jsnb$/u, "");
  // the page's CSP blocks scripts already; a markdown cell's <script> is dropped so the page carries none
  const markdown = (source: string): string =>
    marked.parse(source, { async: false }).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, "");
  const html = notebookToHTML(exportCells(context, request.outputs, redact), {
    title,
    markdown,
    ...(request.theme === undefined ? {} : { theme: request.theme }),
  });
  if (request.path === undefined) return { html };
  const target = await exportTarget(context.root, request.path);
  await writeAtomically(target, html);
  return { html, path: relative(context.root, target).split("\\").join("/") };
}
