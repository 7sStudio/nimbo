// What a paused realm shows through js-debug, in the API's terms: frames mapped to cells and lines with the kernel's and
// the page's own frames left out, scopes with the cells' record shown as a Notebook scope of plain names, and
// evaluations that read cell names from the realm's scope.
import { isAbsolute } from "node:path";

import type {
  CellId,
  DebugFrame,
  DebugPause,
  DebugRealm,
  DebugScope,
  DebugVariable,
} from "@jsnb/core";
import { InvalidSyntax, isJsnbError } from "@jsnb/core";
import { ownCodeDirectories } from "@jsnb/kernel-node";
import { evaluationOf } from "@jsnb/transform";

import { dap } from "../../kernel/debug/protocol.js";
import type { DapConnection } from "../../kernel/debug/dap.js";
import type { StackFrame, StoppedEvent, Variable } from "../../kernel/debug/protocol.js";
import type { Dialect } from "./conditions.js";

/** The names the transform and the kernel put on the record or a frame that no user wrote. */
const plumbing = new Set(["__scope", "__import", "__export", "$peek"]);

const shown = (variable: Variable): boolean =>
  !plumbing.has(variable.name) && !variable.name.startsWith("[[");

/** An error's preview without its stack, whose frames are the compiled code's and the kernel's. */
const stackless = (text: string, type: string | undefined): string => {
  if (type === "string") return text;
  const at = text.search(/\n\s+at /u);
  return at === -1 ? text : text.slice(0, at);
};

/** A function's preview is its whole source; its signature says enough on one row. */
const valueOf = (variable: Variable): string => {
  const value = stackless(variable.value, variable.type);
  if (!/^(?:async )?ƒ |^class /.test(value)) return value;
  const body = value.search(/\s*\{/);
  return body === -1 ? value : value.slice(0, body);
};

const toVariable = (variable: Variable): DebugVariable => ({
  name: variable.name,
  value: valueOf(variable),
  ...(variable.type === undefined || variable.type === "" ? {} : { type: variable.type }),
  ref: variable.variablesReference,
});

/** Which cell a frame's source is, by the path the transform's map names it with. */
export type CellOfPath = (path: string) => CellId | undefined;

const isKernelFile = (path: string): boolean =>
  ownCodeDirectories.some((dir) => path.startsWith(dir));

/** A frame the user wrote: a cell's, or a file of the workspace or its packages; never the kernel's nor Node's. */
function isUserFrame(frame: StackFrame, cellOf: CellOfPath): boolean {
  const path = frame.source?.path;
  if (frame.presentationHint === "label" || path === undefined) return false;
  if (cellOf(path) !== undefined) return true;
  if (frame.source?.presentationHint === "deemphasize") return false;
  return isAbsolute(path) && !isKernelFile(path);
}

/** Where and why the realm stopped: the innermost user frame, when it is a cell's; `stale` when that cell was edited
 * since it last ran, so the line is in its code from before the edit. */
export function pauseOf(
  realm: DebugRealm,
  body: StoppedEvent,
  top: DebugFrame | undefined,
  follows: (cell: CellId) => boolean,
): DebugPause {
  return {
    realm,
    ...(top?.cell !== undefined && !follows(top.cell) ? { stale: true } : {}),
    reason: body.reason,
    ...(body.description === undefined ? {} : { description: body.description }),
    ...(top?.cell === undefined ? {} : { cell: top.cell, line: top.line }),
    ...(body.text === undefined ? {} : { text: body.text }),
  };
}

export function framesOf(frames: readonly StackFrame[], cellOf: CellOfPath): DebugFrame[] {
  return frames
    .filter((frame) => isUserFrame(frame, cellOf))
    .map((frame) => {
      const path = frame.source?.path ?? "";
      const cell = cellOf(path);
      return {
        frameId: String(frame.id),
        line: frame.line,
        col: frame.column,
        fn: frame.name,
        ...(cell === undefined ? { file: path } : { cell }),
      };
    });
}

const variablesOf = async (child: DapConnection, ref: number): Promise<Variable[]> =>
  ref === 0 ? [] : (await dap.variables(child, { variablesReference: ref })).variables;

/** The Notebook scope of a frame: the record's own names, read through an evaluation in that frame. */
async function notebookScope(
  child: DapConnection,
  frameId: number,
  context: { readonly notebookRefs: Set<number>; readonly dialect: Dialect },
): Promise<DebugScope | undefined> {
  const { notebookRefs, dialect } = context;
  try {
    const result = await dap.evaluate(child, {
      expression: dialect.record,
      frameId,
      context: "watch",
    });
    if (result.variablesReference === 0) return undefined;
    notebookRefs.add(result.variablesReference);
    const variables = (await variablesOf(child, result.variablesReference)).filter(shown);
    return {
      name: "Notebook",
      ref: result.variablesReference,
      expensive: false,
      variables: variables.map(toVariable),
    };
  } catch {
    return undefined; // a frame that cannot evaluate (a native one) shows no Notebook scope
  }
}

/** One of js-debug's scopes with its variables read (an expensive one's left out); undefined for a closure over
 * `__scope` alone, which holds nothing the user wrote. */
async function scopeOf(
  child: DapConnection,
  scope: {
    readonly name: string;
    readonly variablesReference: number;
    readonly expensive: boolean;
  },
): Promise<DebugScope | undefined> {
  const base = { name: scope.name, ref: scope.variablesReference, expensive: scope.expensive };
  if (scope.expensive) return base;
  const all = await variablesOf(child, scope.variablesReference);
  const variables = all.filter(shown).map(toVariable);
  return all.length > 0 && variables.length === 0 ? undefined : { ...base, variables };
}

/** The scopes of frame `frameId`: js-debug's, `__scope` left out, the Notebook scope before Global. */
export async function scopesOf(
  child: DapConnection,
  frameId: number,
  context: { readonly notebookRefs: Set<number>; readonly dialect: Dialect },
): Promise<DebugScope[]> {
  const { scopes } = await dap.scopes(child, { frameId });
  const out: DebugScope[] = [];
  for (const scope of scopes) {
    if (scope.name === "Global") {
      const notebook = await notebookScope(child, frameId, context);
      if (notebook) out.push(notebook);
    }
    const read = await scopeOf(child, scope);
    if (read) out.push(read);
  }
  return out;
}

/** The children of `ref`; the record's plumbing left out of the Notebook scope. */
export async function childrenOf(
  child: DapConnection,
  ref: number,
  notebookRefs: ReadonlySet<number>,
): Promise<DebugVariable[]> {
  const variables = await variablesOf(child, ref);
  return (notebookRefs.has(ref) ? variables.filter(shown) : variables).map(toVariable);
}

/** The names a frame holds itself, which an evaluation there reads as they are: every scope's but Global's. */
async function localNames(child: DapConnection, frameId: number): Promise<string[]> {
  const { scopes } = await dap.scopes(child, { frameId });
  const names: string[] = [];
  for (const scope of scopes) {
    if (scope.name === "Global" || scope.expensive) continue;
    for (const variable of await variablesOf(child, scope.variablesReference))
      names.push(variable.name);
  }
  return names;
}

export type Evaluated = { readonly repr: string; readonly type?: string; readonly ref: number };

/** An exception's first line (`ReferenceError: x is not defined`), not V8's "Uncaught" prefix nor the kernel's frames. */
function errorLine(message: string): string {
  const first = message.split("\n")[0] ?? message;
  return first.replace(/^Uncaught (?:(\w+) (?=\1))?/u, "");
}

const failure = (message: string): Evaluated => ({
  repr: errorLine(message),
  type: "error",
  ref: 0,
});

/** The JavaScript to evaluate for `expression` in `frameId`, or the failure that answers it instead. */
async function codeFor(
  child: DapConnection,
  expression: string,
  where: { readonly frameId: number | undefined; readonly dialect: Dialect },
): Promise<string | Evaluated> {
  const { frameId } = where;
  try {
    const locals = frameId === undefined ? [] : await localNames(child, frameId);
    const code = evaluationOf(expression, locals, where.dialect.scope);
    // an awaited promise cannot settle while the realm is paused
    if (frameId !== undefined && code.startsWith("await "))
      return failure("await needs a running realm: resume, then evaluate it");
    return code;
  } catch (error) {
    if (error instanceof InvalidSyntax) return failure(`SyntaxError: ${error.data.detail}`);
    if (isJsnbError(error)) return failure(error.message);
    throw error;
  }
}

/** `expression` evaluated in `frameId` (or the realm's global scope), its cell names read from the realm's scope; an
 * expression that does not parse or throws answers its error as `repr`, typed `error`. */
export async function evaluateIn(
  child: DapConnection,
  expression: string,
  where: { readonly frameId: number | undefined; readonly dialect: Dialect },
): Promise<Evaluated> {
  const { frameId } = where;
  const code = await codeFor(child, expression, where);
  if (typeof code !== "string") return code;
  try {
    const result = await dap.evaluate(child, {
      expression: code,
      context: "repl",
      ...(frameId === undefined ? {} : { frameId }),
    });
    const type = result.type === undefined || result.type === "" ? {} : { type: result.type };
    return { repr: stackless(result.result, result.type), ...type, ref: result.variablesReference };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(message.replace(/^evaluate: /, ""));
  }
}
