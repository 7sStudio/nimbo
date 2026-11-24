// The completion list's kind icons, as VS Code's suggest widget has them: one glyph per kind
// of symbol in VS Code's colours, here the page's syntax tokens: methods and functions in --ctl (VS Code's purple),
// fields, variables and interfaces in --key (its blue), classes and enums in --md (its orange), the rest in the list's
// own ink. The glyphs are Lucide's (ISC), drawn as inline SVG since CodeMirror's list is plain DOM.
import type { Completion } from "@codemirror/autocomplete";

type Node = readonly [string, Readonly<Record<string, string>>];

const glyphs: Readonly<Record<string, readonly Node[]>> = {
  method: [
    [
      "path",
      {
        d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
      },
    ],
    ["path", { d: "m3.3 7 8.7 5 8.7-5" }],
    ["path", { d: "M12 22V12" }],
  ],
  field: [
    [
      "path",
      {
        d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",
      },
    ],
    ["circle", { cx: "7.5", cy: "7.5", r: ".5", fill: "currentColor" }],
  ],
  variable: [
    ["path", { d: "M8 21s-4-3-4-9 4-9 4-9" }],
    ["path", { d: "M16 3s4 3 4 9-4 9-4 9" }],
    ["line", { x1: "15", x2: "9", y1: "9", y2: "15" }],
    ["line", { x1: "9", x2: "15", y1: "9", y2: "15" }],
  ],
  constant: [
    ["line", { x1: "9", x2: "9", y1: "4", y2: "20" }],
    ["path", { d: "M4 7c0-1.7 1.3-3 3-3h13" }],
    ["path", { d: "M18 20c-1.7 0-3-1.3-3-3V4" }],
  ],
  class: [
    ["rect", { x: "16", y: "16", width: "6", height: "6", rx: "1" }],
    ["rect", { x: "2", y: "16", width: "6", height: "6", rx: "1" }],
    ["rect", { x: "9", y: "2", width: "6", height: "6", rx: "1" }],
    ["path", { d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" }],
    ["path", { d: "M12 12V8" }],
  ],
  interface: [
    ["path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }],
    ["path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" }],
  ],
  enum: [
    ["path", { d: "M11 5h10" }],
    ["path", { d: "M11 12h10" }],
    ["path", { d: "M11 19h10" }],
    ["path", { d: "M4 4h1v5" }],
    ["path", { d: "M4 9h2" }],
    ["path", { d: "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" }],
  ],
  module: [
    ["path", { d: "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" }],
    ["path", { d: "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" }],
  ],
  keyword: [
    ["path", { d: "m2 21 9.6-9.6" }],
    ["path", { d: "m7.5 15.5 2.3 2.3a1 1 0 0 1 0 1.4l-2.1 2.1a1 1 0 0 1-1.4 0L4 19" }],
    ["circle", { cx: "15.5", cy: "7.5", r: "5.5" }],
  ],
  text: [
    ["path", { d: "m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" }],
    ["path", { d: "M22 9v7" }],
    ["path", { d: "M3.304 13h6.392" }],
    ["circle", { cx: "18.5", cy: "12.5", r: "3.5" }],
  ],
  type: [
    ["path", { d: "M12 4v16" }],
    ["path", { d: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" }],
    ["path", { d: "M9 20h6" }],
  ],
};

/** CodeMirror's completion type (from the LSP kind) → the glyph and the token that paints it. */
const kinds: Readonly<Record<string, readonly [glyph: string, token: string | null]>> = {
  method: ["method", "ctl"],
  function: ["method", "ctl"],
  class: ["class", "md"],
  enum: ["enum", "md"],
  property: ["field", "key"],
  variable: ["variable", "key"],
  interface: ["interface", "key"],
  type: ["type", "key"],
  constant: ["constant", null],
  namespace: ["module", null],
  keyword: ["keyword", null],
  text: ["text", null],
};

/** The icon at a row's start: the glyph of its kind, or the text glyph. */
export function completionIcon(completion: Completion): SVGSVGElement {
  const [glyph, token] = kinds[completion.type ?? "text"] ?? ["text", null];
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("class", "cm-nimboKind");
  if (token !== null) icon.style.color = `var(--${token})`;
  for (const [tag, attributes] of glyphs[glyph] ?? []) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    icon.append(shape);
  }
  return icon;
}
