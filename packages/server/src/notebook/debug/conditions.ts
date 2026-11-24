// What js-debug gets for a breakpoint's condition and a logpoint: JavaScript that reads the frame's names and, failing
// that, the cells' names from the kernel's scope record, as a cell does; a condition or a part of a log message that
// throws counts as false or prints its error, and leaves its message once in the kernel (errorsCode reads them), never
// a stack on each hit. A logpoint is a condition that prints through the record's console (the cell's output) and is
// false.
import { InvalidSyntax } from "@jsnb/core";
import { scopeKeyName } from "@jsnb/kernel-node";
import { conditionOf } from "@jsnb/transform";

import { z } from "zod";

import type { DapConnection } from "../../kernel/debug/dap.js";
import { dap } from "../../kernel/debug/protocol.js";
import type { BreakpointRecord } from "./breakpoints.js";

/** The record of the cells' names, as an expression evaluated in the kernel. */
export const scopeRecord = `globalThis.process[Symbol.for(${JSON.stringify(scopeKeyName)})]`;

const errorsKey = JSON.stringify("jsnb.kernel.breakpointErrors");
const errors = `(globalThis.process[Symbol.for(${errorsKey})] ??= new Map())`;

/** Keeps the first error of breakpoint `id`, in the catch block of the code around a condition. */
const keep = (id: string): string => {
  const key = JSON.stringify(id);
  return `${errors}.has(${key}) || ${errors}.set(${key}, String(error && error.message || error));`;
};

/** Reads and clears the kept errors, as one JSON object by breakpoint id. */
const errorsCode = `(() => { const kept = globalThis.process[Symbol.for(${errorsKey})]; if (!kept) return "{}"; const out = JSON.stringify(Object.fromEntries(kept)); kept.clear(); return out; })()`;

const ErrorsAnswer = z.record(z.string(), z.string());

/** The first error each condition or logpoint kept in the kernel since the last read, by breakpoint id. */
export async function keptErrors(child: DapConnection): Promise<Record<string, string>> {
  const answer = await dap.evaluate(child, { expression: errorsCode, context: "clipboard" });
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

function conditionCode(id: string, condition: string): Translated {
  try {
    const js = conditionOf(condition, scopeRecord);
    return {
      condition: `(() => { try { return Boolean(${js}); } catch (error) { ${keep(id)} return false; } })()`,
    };
  } catch (error) {
    const message = syntaxMessage(error);
    if (message === undefined) throw error;
    return { condition: "false", message };
  }
}

function logpointCode(id: string, logMessage: string): Translated {
  const { text, expressions, unclosed } = partsOf(logMessage);
  let message = unclosed ? "A { in the log message has no }." : undefined;
  const values = expressions.map((expression) => {
    try {
      const js = conditionOf(expression, scopeRecord);
      return `(() => { try { return ${js}; } catch (error) { ${keep(id)} return "<" + (error && error.message || error) + ">"; } })()`;
    } catch (error) {
      const syntax = syntaxMessage(error);
      if (syntax === undefined) throw error;
      message ??= syntax;
      return JSON.stringify(`<${syntax}>`);
    }
  });
  const format = text.map((part) => part.replaceAll("%", "%%")).join("%s");
  const print = `${scopeRecord}.console.log(${[JSON.stringify(format), ...values].join(", ")})`;
  return {
    condition: `(() => { ${print}; return false; })()`,
    ...(message === undefined ? {} : { message }),
  };
}

/** The condition js-debug gets for `breakpoint` (none for a plain one) and the message of one that does not parse. */
export function translated(breakpoint: BreakpointRecord): Translated {
  if (breakpoint.logMessage !== undefined)
    return logpointCode(breakpoint.breakpointId, breakpoint.logMessage);
  if (breakpoint.condition !== undefined)
    return conditionCode(breakpoint.breakpointId, breakpoint.condition);
  return {};
}
