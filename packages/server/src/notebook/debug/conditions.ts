// What js-debug gets for a breakpoint's condition and a logpoint: JavaScript that reads the frame's names and, failing
// that, the cells' names from the realm's scope (the kernel's record, the page's cell scope), as a cell does; a
// condition or a part of a log message that throws counts as false or prints its error, and leaves its message once in
// the realm (errorsCode reads them), never a stack on each hit. A logpoint is a condition that prints through the
// scope's console (the cell's output) and is false.
import type { DebugRealm } from "@jsnb/core";
import { InvalidSyntax, pageRecordKey, pageScopeKey } from "@jsnb/core";
import { scopeKeyName } from "@jsnb/kernel-node";
import { conditionOf } from "@jsnb/transform";

import { z } from "zod";

import type { DapConnection } from "../../kernel/debug/dap.js";
import { dap } from "../../kernel/debug/protocol.js";
import type { BreakpointRecord } from "./breakpoints.js";

/** How a realm's code reads the cells' names, as expressions evaluated in it. */
export type Dialect = {
  /** What a condition or an evaluation reads a name through when the frame has none of its own. */
  readonly scope: string;
  /** The record of the names the cells defined: the Notebook scope. */
  readonly record: string;
  /** Where the conditions' errors are kept. */
  readonly holder: string;
};

const symbolOn = (holder: string, key: string) => `${holder}[Symbol.for(${JSON.stringify(key)})]`;

/** The record of the cells' names, as an expression evaluated in the kernel. */
const kernelRecord = symbolOn("globalThis.process", scopeKeyName);

/** In the page: a frame of a cell reads its own run's scope (`__scope`, the cell function's parameter, which any
 * function of the cell that reads a cell name closes over), else the latest run's (runtime-web's debugScope.ts). */
const pageScope = `(typeof __scope === "object" && __scope !== null ? __scope : ${symbolOn("globalThis", pageScopeKey)})`;

export const dialects: Readonly<Record<DebugRealm, Dialect>> = {
  server: { scope: kernelRecord, record: kernelRecord, holder: "globalThis.process" },
  client: { scope: pageScope, record: symbolOn("globalThis", pageRecordKey), holder: "globalThis" },
};

const errorsKey = "jsnb.kernel.breakpointErrors";
const errorsOf = (dialect: Dialect) => `(${symbolOn(dialect.holder, errorsKey)} ??= new Map())`;

/** Keeps the first error of breakpoint `id`, in the catch block of the code around a condition. */
const keep = (dialect: Dialect, id: string): string => {
  const key = JSON.stringify(id);
  const errors = errorsOf(dialect);
  return `${errors}.has(${key}) || ${errors}.set(${key}, String(error && error.message || error));`;
};

/** Reads and clears the kept errors, as one JSON object by breakpoint id. */
const errorsCode = (dialect: Dialect) =>
  `(() => { const kept = ${symbolOn(dialect.holder, errorsKey)}; if (!kept) return "{}"; const out = JSON.stringify(Object.fromEntries(kept)); kept.clear(); return out; })()`;

const ErrorsAnswer = z.record(z.string(), z.string());

/** The first error each condition or logpoint kept in the realm since the last read, by breakpoint id. */
export async function keptErrors(
  child: DapConnection,
  dialect: Dialect,
): Promise<Record<string, string>> {
  const answer = await dap.evaluate(child, {
    expression: errorsCode(dialect),
    context: "clipboard",
  });
  // js-debug answers a string for the clipboard as its JSON form
  const text: unknown = JSON.parse(answer.result);
  const kept = ErrorsAnswer.safeParse(typeof text === "string" ? JSON.parse(text) : text);
  return kept.success ? kept.data : {};
}

const syntaxMessage = (error: unknown): string | undefined => {
  if (!(error instanceof InvalidSyntax)) return undefined;
  const { detail } = error.data;
  return detail.startsWith("A condition") ? detail : `SyntaxError: ${detail}`;
};

const quotes = new Set(["'", '"', "`"]);

type Scan = {
  readonly text: string[];
  readonly expressions: string[];
  depth: number;
  plain: string;
  current: string;
  quote: string | undefined;
  escaped: boolean;
};

/** One character inside a string literal of an expression. */
function inQuote(scan: Scan, char: string): void {
  scan.current += char;
  if (scan.escaped) scan.escaped = false;
  else if (char === "\\") scan.escaped = true;
  else if (char === scan.quote) scan.quote = undefined;
}

/** One character inside an `{expression}`. */
function inExpression(scan: Scan, char: string): void {
  if (scan.quote !== undefined) inQuote(scan, char);
  else if (quotes.has(char)) {
    scan.quote = char;
    scan.current += char;
  } else if (char === "}" && --scan.depth === 0) {
    scan.expressions.push(scan.current);
    scan.text.push(scan.plain);
    scan.plain = "";
  } else {
    if (char === "{") scan.depth += 1;
    scan.current += char;
  }
}

/** One character of an `{expression}` or of the text around them. */
function step(scan: Scan, char: string): void {
  if (scan.depth > 0) inExpression(scan, char);
  else if (char === "{") {
    scan.depth = 1;
    scan.current = "";
  } else scan.plain += char;
}

/** The text and the `{expression}`s of a log message, braces nesting and string literals read as such; `unclosed`
 * when a `{` has no `}`. */
function partsOf(message: string) {
  const scan: Scan = {
    text: [],
    expressions: [],
    depth: 0,
    plain: "",
    current: "",
    quote: undefined,
    escaped: false,
  };
  for (const char of message) step(scan, char);
  scan.text.push(scan.plain);
  return { text: scan.text, expressions: scan.expressions, unclosed: scan.depth > 0 };
}

type Translated = { readonly condition?: string; readonly message?: string };

function conditionCode(dialect: Dialect, id: string, condition: string): Translated {
  try {
    const js = conditionOf(condition, dialect.scope);
    return {
      condition: `(() => { try { return Boolean(${js}); } catch (error) { ${keep(dialect, id)} return false; } })()`,
    };
  } catch (error) {
    const message = syntaxMessage(error);
    if (message === undefined) throw error;
    return { condition: "false", message };
  }
}

function logpointCode(dialect: Dialect, id: string, logMessage: string): Translated {
  const { text, expressions, unclosed } = partsOf(logMessage);
  let message = unclosed ? "A { in the log message has no }." : undefined;
  const values = expressions.map((expression) => {
    try {
      const js = conditionOf(expression, dialect.scope);
      return `(() => { try { return ${js}; } catch (error) { ${keep(dialect, id)} return "<" + (error && error.message || error) + ">"; } })()`;
    } catch (error) {
      const syntax = syntaxMessage(error);
      if (syntax === undefined) throw error;
      message ??= syntax;
      return JSON.stringify(`<${syntax}>`);
    }
  });
  const format = text.map((part) => part.replaceAll("%", "%%")).join("%s");
  const print = `${dialect.scope}.console.log(${[JSON.stringify(format), ...values].join(", ")})`;
  return {
    condition: `(() => { ${print}; return false; })()`,
    ...(message === undefined ? {} : { message }),
  };
}

/** The condition js-debug gets for `breakpoint` (none for a plain one) and the message of one that does not parse. */
export function translated(breakpoint: BreakpointRecord, dialect: Dialect): Translated {
  if (breakpoint.logMessage !== undefined)
    return logpointCode(dialect, breakpoint.breakpointId, breakpoint.logMessage);
  if (breakpoint.condition !== undefined)
    return conditionCode(dialect, breakpoint.breakpointId, breakpoint.condition);
  return {};
}
