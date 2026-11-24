// notebook.summary (03-api §4.2): what a notebook holds, without opening it and without running anything, for Home's
// search and preview. An open notebook is read from its session, so an edit not saved yet shows; a
// closed one from its file, through the path rules every command follows (notebookFile.ts: inside the workspace, no
// link out of it) and core's parser, which refuses a file it cannot load as notebook.open would. The cells are named
// and their routes, exports, packages and env names read by transform's analysis and plain patterns (core's
// summarize), never by the kernel; the packages the workspace cannot resolve by the rule a run's pre-flight follows; an
// open notebook's last result from its session's runs (a file holds no outputs).
import type { Execution, IdGenerator, NotebookSummary, Settings, SummaryCell } from "@jsnb/core";
import { lastResult, NotebookNotFound, parse, summarize } from "@jsnb/core";
import { missingPackages, packageNames } from "@jsnb/kernel-node";

import { notebookPath, readNotebook } from "../../files/notebooks/notebookFile.js";
import { serverVersion } from "../../files/version.js";
import type { Session } from "../session/session.js";
import { analysisOf } from "../session/analysis.js";

type Read = Pick<SummaryCell, "type" | "source" | "lastEdit" | "title"> & {
  /** The cell's last run, with its outputs, when its notebook is open. */
  readonly run?: Execution | null;
};

/** The cells of the closed notebook `ref` as its file holds them. */
async function fromFile(root: string, ids: IdGenerator, ref: string): Promise<readonly Read[]> {
  const read = await readNotebook(await notebookPath(root, ref, "path"));
  if (read.kind === "missing") throw new NotebookNotFound({ path: ref });
  const parsed = parse(read.text, { ids, path: ref, appVersion: serverVersion });
  if (!parsed.ok) throw parsed.error;
  return parsed.value.doc.cells.map(({ type, source, meta }) => ({
    type,
    source,
    lastEdit: meta.lastEdit,
    title: meta.title,
  }));
}

/** The cells of `ref`: its session's when it is open (an open that failed reads the file instead), else its file's. */
async function cellsOf(
  options: { readonly root: string; readonly ids: IdGenerator },
  opening: Promise<Session> | undefined,
  ref: string,
): Promise<readonly Read[]> {
  const session = await opening?.catch(() => undefined);
  if (session === undefined) return fromFile(options.root, options.ids, ref);
  return session.state().cells.map(({ id, type, source, meta }) => ({
    type,
    source,
    lastEdit: meta.lastEdit,
    title: meta.title,
    run: session.outputs(id),
  }));
}

/** The summary of the notebook `ref`; `opening` is its session when it is open. */
export async function summaryOf(
  options: {
    readonly root: string;
    readonly ids: IdGenerator;
    readonly settings?: () => Settings;
  },
  opening: Promise<Session> | undefined,
  ref: string,
): Promise<NotebookSummary> {
  const cells = (await cellsOf(options, opening, ref)).map((cell) => {
    const analysis = analysisOf(cell.type, cell.source);
    return { ...cell, analysis, facts: cell.type === "markdown" ? undefined : analysis };
  });
  const imports = cells.flatMap((cell) => cell.analysis.imports);
  return summarize(ref, cells, {
    packages: packageNames(imports),
    missing: missingPackages(options.root, imports),
    lastResult: lastResult(cells.map((cell) => cell.run ?? null)),
    firstLine: options.settings?.()["cells.titleFromFirstLine"] === true,
  });
}
