// Syntax errors in the editor: the cell's last run reports a SyntaxError with its line and column (the
// kernel parsed the source, nothing ran); the editor underlines that place in red until the user changes the text
// (CellEditor), the header's State says where and the error block carries the message and the excerpt. Staleness never changes the editor.
import type { Diagnostic as ServiceDiagnostic, ErrorInfo } from "@jsnb/core";
import type * as Lint from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Where a syntax error points: a 1-based line and column. */
export type SyntaxPlace = { readonly line: number; readonly col: number; readonly message: string };

/** The place of a SyntaxError the kernel reported, or null for any other error or one without a frame. */
export function syntaxPlace(error: ErrorInfo | undefined): SyntaxPlace | null {
  if (error?.name !== "SyntaxError") return null;
  const frame = error.frames[0];
  if (frame === undefined) return null;
  return { line: frame.line, col: frame.col, message: error.message };
}

/** The diagnostic for `place` in `doc`: the rest of the word at the place, or one character, inside the document. */
export function syntaxDiagnostic(doc: Text, place: SyntaxPlace): Diagnostic {
  const line = doc.line(Math.min(Math.max(place.line, 1), doc.lines));
  const from = Math.min(line.from + Math.max(place.col - 1, 0), line.to);
  const word = /^\w+/u.exec(line.text.slice(from - line.from))?.[0].length ?? 0;
  const to = Math.min(from + Math.max(word, 1), doc.length);
  return {
    from: Math.min(from, Math.max(to - 1, 0)),
    to,
    severity: "error",
    message: place.message,
  };
}

/** A language service diagnostic (0-based line and character) in `doc`, clamped to the document; an empty
 * range covers the character at its place, so it is seen. */
function serviceDiagnostic(doc: Text, diagnostic: ServiceDiagnostic): Diagnostic {
  const offset = (line: number, character: number): number => {
    if (line + 1 > doc.lines) return doc.length;
    const at = doc.line(line + 1);
    return Math.min(at.from + character, at.to);
  };
  const from = offset(diagnostic.range.start.line, diagnostic.range.start.character);
  const to = Math.max(from, offset(diagnostic.range.end.line, diagnostic.range.end.character));
  const end = to > from ? to : Math.min(from + 1, doc.length);
  return {
    from: end > from ? from : Math.max(from - 1, 0),
    to: Math.max(end, from),
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: diagnostic.source === "nimbo" ? "nimbo" : "ts",
  };
}

let lint: Promise<typeof Lint> | undefined;

/** The one owner of a cell's underlines: the language service's list when it gave the cell one, else the
 * syntax error of the last run. @codemirror/lint is a chunk of its own, loaded the first time something is underlined
 * (the first-load budget); before that there is nothing to clear. A view gone meanwhile, or a chunk that would
 * not load (the error block and Problems still say it all), is left alone. */
export async function markDiagnostics(
  target: () => EditorView | undefined,
  place: SyntaxPlace | null,
  service: readonly ServiceDiagnostic[] | null,
): Promise<void> {
  if (place === null && (service === null || service.length === 0) && lint === undefined) return;
  lint ??= import("@codemirror/lint");
  const { setDiagnostics } = await lint.catch(() => ({ setDiagnostics: undefined }));
  const view = target();
  if (view === undefined || setDiagnostics === undefined) return;
  const marks =
    service !== null
      ? service.map((diagnostic) => serviceDiagnostic(view.state.doc, diagnostic))
      : place === null
        ? []
        : [syntaxDiagnostic(view.state.doc, place)];
  view.dispatch(setDiagnostics(view.state, marks));
}
