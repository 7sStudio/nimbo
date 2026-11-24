// The language service's popups as VS Code draws them: a signature in the editor's syntax
// colours (signatureText.ts), the documentation as markdown with its JSDoc tags and highlighted examples, a thin line
// between the two, and a body that scrolls past a height with a small expand button at its top end that opens the
// whole hint in a dialog, as JetBrains' documentation popup does.
import type { LSPPlugin } from "@codemirror/lsp-client";

import { clickedLink } from "./links.js";
import { signaturePieces } from "./signatureText.js";

/** The expand button's icon, Lucide's maximize-2. */
const expandPath = "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7";

/** What the expand button hands the page: a title and the hint's sanitized HTML. */
export type Expand = (title: string, html: string) => void;

/** Spans for `text` in syntax colours; `active` is the range of the parameter a hint is at, painted as VS Code does. */
export function codeLine(text: string, active?: readonly [number, number]): HTMLElement {
  const line = document.createElement("div");
  line.className = "cm-nimboCode";
  // inline as well, for the expand dialog outside the editor's theme
  line.style.fontFamily = "var(--mono)";
  line.style.whiteSpace = "pre-wrap";
  const [from, to] = active ?? [0, 0];
  let at = 0;
  let activeSpan: HTMLElement | null = null;
  const put = (part: string, token: string | undefined, inActive: boolean) => {
    if (part === "") return;
    const span = document.createElement("span");
    span.textContent = part;
    // inline, so the same spans keep their colours in the expand dialog, outside the editor's theme; the active
    // parameter is one colour, as VS Code paints it
    if (token !== undefined && !inActive) span.style.color = `var(--${token})`;
    if (!inActive) {
      line.append(span);
      return;
    }
    if (activeSpan === null) {
      activeSpan = document.createElement("span");
      activeSpan.className = "cm-lsp-active-parameter";
      line.append(activeSpan);
    }
    activeSpan.append(span);
  };
  for (const piece of signaturePieces(text)) {
    const end = at + piece.text.length;
    // a piece split where the active parameter starts and ends
    const cuts = [at, Math.min(Math.max(from, at), end), Math.min(Math.max(to, at), end), end];
    for (let index = 0; index < 3; index += 1) {
      const start = cuts[index] ?? at;
      const stop = cuts[index + 1] ?? end;
      put(piece.text.slice(start - at, stop - at), piece.token, index === 1 && to > from);
    }
    at = end;
  }
  return line;
}

/** Markdown from the service, rendered and sanitized by the library (its code fences highlighted). */
export function docsElement(plugin: LSPPlugin, markdown: string): HTMLElement {
  const docs = document.createElement("div");
  docs.className = "cm-lsp-documentation cm-nimboDocs";
  docs.innerHTML = plugin.docToHTML(markdown, "markdown");
  return docs;
}

/** The name a hint is about, for the dialog's title: the first word after TypeScript's `(kind)` and keywords. */
export function titleOf(signature: string): string {
  const rest = signature.replace(/^\((?:[a-z]+ ?)+\) /u, "");
  const name = /(?:^|\s)((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*[(<:?]/u.exec(rest)?.[1];
  const first = rest.split(/\s/u)[0] ?? "";
  return name ?? (first === "" ? "Documentation" : first);
}

function expandButton(onClick: () => void): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-nimboExpand";
  button.title = "Expand";
  button.setAttribute("aria-label", "Expand");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", expandPath);
  icon.append(path);
  button.append(icon);
  // the editor keeps its focus and its popup: a press on the button never reaches CodeMirror's blur
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
}

/** A hint's frame: its parts in a body that scrolls past the popup's height, and the expand button at its top end,
 * shown while the body overflows. */
export function hintFrame(
  parts: readonly HTMLElement[],
  title: string,
  expand: Expand | null,
): HTMLElement {
  const frame = document.createElement("div");
  frame.className = "cm-nimboHint";
  const body = document.createElement("div");
  body.className = "cm-nimboHintBody";
  parts.forEach((part, index) => {
    if (index > 0) part.classList.add("cm-nimboHintPart");
    body.append(part);
  });
  frame.append(body);
  // a documentation link goes to its definition or opens its web page, never navigates the page
  frame.addEventListener("click", (event) => {
    clickedLink(event);
  });
  if (expand !== null) {
    frame.append(
      expandButton(() => {
        expand(title, body.innerHTML);
      }),
    );
    const check = () => {
      frame.toggleAttribute("data-overflow", body.scrollHeight > body.clientHeight + 1);
    };
    if (typeof ResizeObserver === "function") new ResizeObserver(check).observe(body);
  }
  return frame;
}
