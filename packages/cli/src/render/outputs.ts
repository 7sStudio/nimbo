// The human rendering of a run: its status line, then each output as the page shows it: stream text, a
// value's tree (output-view's model), a display's mime, a DOM's text, an event, an error with its frames.
import type { ErrorInfo, Execution, Output } from "@jsnb/core";
import { preview } from "@jsnb/output-view/model";

import { treeLines } from "./tree.js";

const withNewline = (text: string): string =>
  text === "" || text.endsWith("\n") ? text : `${text}\n`;

/** `Name: message`, then `  at fn (c_a1b2c3:2:5)` per frame. */
export function errorLines(error: ErrorInfo): string[] {
  const frames = error.frames.map((frame) => {
    const where = `${frame.cell ?? frame.file ?? "?"}:${String(frame.line)}:${String(frame.col)}`;
    return frame.fn === undefined ? `  at ${where}` : `  at ${frame.fn} (${where})`;
  });
  return [`${error.name}: ${error.message}`, ...frames];
}

const jsonMimes: Readonly<Record<string, string>> = {
  "application/json": "json",
  "application/vnd.jsnb.table+json": "table",
};

/** A display: text as it is, display.json's and display.table's value as a tree, anything else by its mime and size. */
function displayText(output: Extract<Output, { readonly kind: "display" }>): string {
  const label = jsonMimes[output.mime];
  if (label !== undefined) {
    try {
      return `[${label}]\n${treeLines(JSON.parse(output.data)).join("\n")}\n`;
    } catch {
      // not JSON after all: shown by its mime below
    }
  }
  return output.mime.startsWith("text/")
    ? `[${output.mime}]\n${withNewline(output.data)}`
    : `[${output.mime}, ${String(output.data.length)} characters]\n`;
}

/** One output's text, newline-terminated. */
function outputText(output: Output, cell: string): string {
  switch (output.kind) {
    case "stream":
      return withNewline(output.text);
    case "value": {
      const cut = output.truncated
        ? [`(cut at the output limit; nimbo outputs ${cell} --full prints the whole value)`]
        : [];
      return `${[...treeLines(output.json), ...cut].join("\n")}\n`;
    }
    case "display":
      return displayText(output);
    case "dom":
      return withNewline(output.text);
    case "event":
      return `[event ${output.name} at ${output.at}] ${preview(output.data)
        .map((token) => token.text)
        .join("")}\n`;
    case "error":
      return `${errorLines(output.error).join("\n")}\n`;
  }
}

/** Where a realm is paused and the verbs that go on from there, for a run whose wait answered on the pause. */
function pausedNote(execution: Execution): string | undefined {
  const { paused } = execution;
  if (paused === undefined) return undefined;
  const where =
    paused.cell === undefined ? "" : ` at ${paused.cell} line ${String(paused.line ?? "?")}`;
  const what = paused.realm === "client" ? "the headless page" : "the kernel";
  return ` (${what} is paused in the debugger${where}: ${paused.reason})\n  nimbo debug stack to see where, nimbo debug resume to go on`;
}

/** `x_9f8e7d6c ok 12 ms`, `… running (timed out waiting)`. */
function statusLine(execution: Execution): string {
  const took =
    execution.durationMs === undefined ? "" : ` ${String(Math.round(execution.durationMs))} ms`;
  const waited = execution.timedOut === true ? " (still running; the wait timed out)" : "";
  return `${execution.cell} ${execution.id} ${execution.status}${took}${pausedNote(execution) ?? waited}\n`;
}

/**
 * How many lines of one output a run prints (VS Code's notebook.output.textLineLimit is 30): a run of a large value
 * would otherwise print it all (52 000 lines for the data example's --all); nimbo outputs prints every line.
 */
export const runLineLimit = 30;

/** `text` cut to its first `limit` lines, with the line that says how many were left and where they are. */
function capped(text: string, limit: number, cell: string): string {
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  // a few lines over the limit are shown whole: a note in their place would save nothing
  if (lines.length <= limit + 5) return text;
  const rest = lines.length - limit;
  return `${lines.slice(0, limit).join("\n")}\n… ${String(rest)} more lines (nimbo outputs ${cell})\n`;
}

/**
 * A run: its status line, its outputs, and the error it ended with; with `lineLimit`, each output (not the error) is
 * cut to that many lines.
 */
export function executionText(execution: Execution, lineLimit?: number): string {
  const outputs = execution.outputs
    .map((output) => {
      const text = outputText(output, execution.cell);
      return lineLimit === undefined || output.kind === "error"
        ? text
        : capped(text, lineLimit, execution.cell);
    })
    .join("");
  const error = execution.error === undefined ? "" : `${errorLines(execution.error).join("\n")}\n`;
  return `${statusLine(execution)}${outputs}${error}`;
}
