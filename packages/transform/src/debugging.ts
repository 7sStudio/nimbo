// What the debugger asks of the transform: an expression evaluated in a paused frame with the cell names it reads
// taken from the notebook's scope, and `debugger;` statements placed on a client cell's breakpoint lines.
import { InvalidSyntax } from "@jsnb/core";
import ts from "typescript";

import { createClassify } from "./classify.js";
import { createCellProgram } from "./program.js";
import { isAssignmentPattern, isReferencePosition, isTypeLevel } from "./references.js";

const identifier = /^[A-Za-z_$][\w$]*$/;

/** The words a strict-mode parameter may not be named. */
const reserved = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends false finally for " +
    "function if import in instanceof new null return super switch this throw true try typeof var void while with " +
    "yield let static implements interface package private protected public await arguments eval"
  ).split(" "),
);

/** A frame's local names a parameter list can hold: identifiers, no reserved word, no `this`. */
function parameterNames(locals: readonly string[]): string[] {
  return [...new Set(locals)].filter((name) => identifier.test(name) && !reserved.has(name));
}

const hasTypeLevelAncestor = (node: ts.Node, stop: ts.Node): boolean =>
  ts.findAncestor(node.parent, (at) => (at === stop ? "quit" : isTypeLevel(at))) !== undefined;

type Edit = { readonly at: number; readonly end: number; readonly text: string };

/** Applies `edits` (none overlapping) to `text`. */
function applied(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.at - a.at))
    out = `${out.slice(0, edit.at)}${edit.text}${out.slice(edit.end)}`;
  return out;
}

/** The TypeScript of an expression as JavaScript: types stripped, comments dropped. */
function strippedTypes(expression: string): string {
  const { outputText } = ts.transpileModule(`(\n${expression}\n);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2024, removeComments: true },
    reportDiagnostics: false,
  });
  return outputText.trim().replace(/;$/, "");
}

/** The expression, its file and where it starts and ends in it, as one function's return parsed. */
type Parsed = {
  readonly file: ts.SourceFile;
  readonly classify: ReturnType<typeof createClassify>;
  readonly start: number;
  readonly end: number;
  /** It awaits (outside any function of its own). */
  readonly awaits: boolean;
};

const awaitsAt = (node: ts.Node, root: ts.Node): boolean =>
  ts.isAwaitExpression(node) &&
  ts.findAncestor(node.parent, (at) => (at === root ? "quit" : ts.isFunctionLike(at))) ===
    undefined;

/** `expression` returned by an async function whose parameters are `locals`; InvalidSyntax when it does not parse. */
function parsed(expression: string, locals: readonly string[]): Parsed {
  const head = `async function frame(${parameterNames(locals).join(", ")}) {\nreturn (\n`;
  const { program, file } = createCellProgram(`${head}${expression}\n);\n}\n`, "evaluate.ts");
  const [problem] = program.getSyntacticDiagnostics(file);
  if (problem) {
    const { line, character } = file.getLineAndCharacterOfPosition(problem.start);
    const detail = ts.flattenDiagnosticMessageText(problem.messageText, "\n");
    const last = expression.split("\n").length;
    throw new InvalidSyntax({
      line: Math.min(Math.max(1, line - 1), last),
      col: character + 1,
      detail,
    });
  }
  const classify = createClassify(program.getTypeChecker(), file);
  const [frame] = file.statements;
  let awaits = false;
  const find = (node: ts.Node): void => {
    if (frame !== undefined && awaitsAt(node, frame)) awaits = true;
    else ts.forEachChild(node, find);
  };
  if (frame !== undefined) ts.forEachChild(frame, find);
  return { file, classify, start: head.length, end: head.length + expression.length, awaits };
}

/** How a name the frame does not hold is read: from the scope record outright (an evaluation in a frame whose names
 * are known), or the frame's own when it has it, else the record's (a breakpoint condition, whose frame is not known). */
type Reading = "scoped" | "guarded";

/** `node` with the parentheses around it: what its parent sees. */
function outermost(node: ts.Node): ts.Node {
  let at = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  return at;
}

/** True when `node` is what a call or a tagged template calls, whose `this` a member access would change. */
function isCallee(node: ts.Node): boolean {
  const { parent } = node;
  return (
    (ts.isCallExpression(parent) && parent.expression === node) ||
    (ts.isTaggedTemplateExpression(parent) && parent.tag === node)
  );
}

/** True when `node` is assigned, updated or destructured into. */
function isWritten(node: ts.Node): boolean {
  const { parent } = node;
  if (ts.isBinaryExpression(parent) && parent.left === node)
    return (
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    );
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    return (
      parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken
    );
  if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === node)
    return true;
  return isAssignmentPattern(parent);
}

/** What reads identifier `node` (whose outer form is `outer`) in `reading`, parenthesised so it means the same wherever
 * it stands: a callee is called with no `this`, as a cell calls it, and under `typeof` an unknown name is undefined. */
function readOf(node: ts.Identifier, outer: ts.Node, reading: Reading): string {
  const name = JSON.stringify(node.text);
  const typeOf = ts.isTypeOfExpression(outer.parent);
  if (reading === "guarded")
    return `(${typeOf ? "__jsnbPeek" : "__jsnbRead"}(${name}, () => ${node.text}))`;
  if (typeOf) return `__jsnbScope.$peek(${name})`;
  return isCallee(outer) ? `(0, __jsnbScope.${node.text})` : `(__jsnbScope.${node.text})`;
}

const isShorthandName = (node: ts.Identifier): boolean =>
  ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node;

/** True when `node`, the name of a shorthand property (`{ name }`) or the identifier `outer` holds, is written. */
const writes = (node: ts.Identifier, outer: ts.Node, shorthand: boolean): boolean =>
  shorthand ? isAssignmentPattern(node.parent.parent) : isWritten(outer);

/** A condition runs on every hit: one that assigns a name, at offset `at` of the expression, is refused. */
function writeRefused(read: Parsed, at: number, name: string): InvalidSyntax {
  const before = read.file.text.slice(read.start, read.start + at).split("\n");
  return new InvalidSyntax({
    line: before.length,
    col: (before.at(-1)?.length ?? 0) + 1,
    detail: `A condition cannot assign ${name}.`,
  });
}

/** The edit that reads identifier `node` from the scope record, or none for a name the frame or the expression has and
 * for the operand of `delete`, which then means what it means in the frame; a guarded reading refuses a write. */
function editOf(node: ts.Identifier, read: Parsed, reading: Reading): Edit | undefined {
  const shorthand = isShorthandName(node);
  if (!shorthand && !isReferencePosition(node)) return undefined;
  if (hasTypeLevelAncestor(node, read.file) || read.classify(node) !== "free") return undefined;
  const outer = shorthand ? node : outermost(node);
  if (ts.isDeleteExpression(outer.parent)) return undefined;
  const at = node.getStart(read.file) - read.start;
  if (reading === "guarded" && writes(node, outer, shorthand))
    throw writeRefused(read, at, node.text);
  const value = readOf(node, outer, reading);
  return { at, end: node.end - read.start, text: shorthand ? `${node.text}: ${value}` : value };
}

/** The edits of every identifier inside the expression. */
function editsOf(read: Parsed, reading: Reading): Edit[] {
  const edits: Edit[] = [];
  const visit = (node: ts.Node): void => {
    const inside = node.getStart(read.file) >= read.start && node.end <= read.end;
    const edit = inside && ts.isIdentifier(node) ? editOf(node, read, reading) : undefined;
    if (edit) edits.push(edit);
    ts.forEachChild(node, visit);
  };
  visit(read.file);
  return edits;
}

/**
 * `expression` as JavaScript to evaluate in a paused frame whose own names are `locals`: every name it reads or writes
 * that is not one of them, nor declared inside it, is read from `scope` (an expression giving the notebook's scope
 * record), as a cell's code reads it from `__scope`. An expression that awaits becomes one top-level `await` of an
 * async function. InvalidSyntax for an expression that does not parse.
 */
export function evaluationOf(expression: string, locals: readonly string[], scope: string): string {
  const read = parsed(expression, locals);
  const edits = editsOf(read, "scoped");
  const js = strippedTypes(applied(expression, edits));
  if (read.awaits) return `await ((async (__jsnbScope) => ${js})(${scope}))`;
  return edits.length === 0 ? js : `((__jsnbScope) => ${js})(${scope})`;
}

/**
 * `expression` as JavaScript for a breakpoint's condition or a logpoint's `{…}`, evaluated in a frame whose names are
 * not known when it is set: each name it reads is the frame's when the frame has it, else the scope record's (a name
 * neither has throws its ReferenceError). InvalidSyntax for an expression that does not parse, and for one that awaits.
 */
export function conditionOf(expression: string, scope: string): string {
  const read = parsed(expression, []);
  if (read.awaits)
    throw new InvalidSyntax({ line: 1, col: 1, detail: "A condition cannot await." });
  const js = strippedTypes(applied(expression, editsOf(read, "guarded")));
  const fallback = (read: string) =>
    `(name, get) => { try { return get(); } catch (error) { if (error instanceof ReferenceError) return ${read}; throw error; } }`;
  const reader = fallback(`${scope}[name]`);
  const peek = fallback(`${scope}.$peek(name)`);
  return `((__jsnbRead, __jsnbPeek) => ${js})(${reader}, ${peek})`;
}

/** True for a statement in a list of statements, where one more statement before it changes nothing else. */
const inStatementList = (node: ts.Node): boolean =>
  ts.isBlock(node.parent) ||
  ts.isSourceFile(node.parent) ||
  ts.isCaseClause(node.parent) ||
  ts.isDefaultClause(node.parent) ||
  ts.isModuleBlock(node.parent);

/**
 * `source` with `debugger;` before the first statement that starts on each of `lines` (1-based), where the browser's
 * DevTools then pause; a line no statement starts on gets none. Line numbers do not change.
 */
export function withDebuggerStatements(source: string, lines: readonly number[]): string {
  const wanted = new Set(lines);
  if (wanted.size === 0) return source;
  const file = ts.createSourceFile(
    "cell.ts",
    source,
    ts.ScriptTarget.ES2024,
    true,
    ts.ScriptKind.TS,
  );
  const found = new Map<number, number>();
  const visit = (node: ts.Node): void => {
    if (ts.isStatement(node) && !ts.isBlock(node) && inStatementList(node)) {
      const at = node.getStart(file);
      const line = file.getLineAndCharacterOfPosition(at).line + 1;
      if (wanted.has(line) && !found.has(line)) found.set(line, at);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return applied(
    source,
    [...found.values()].map((at) => ({ at, end: at, text: "debugger; " })),
  );
}
