// The find row's DOM (editor/findRow.ts): CodeMirror's panels are plain DOM, so the row is built with these: an element
// with its attributes and children, a button with its label and tooltip, and Lucide's icons as inline paths.

export const svg = (path: string): SVGSVGElement => {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("class", "cm-findIcon");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  icon.append(shape);
  return icon;
};
/** Lucide's search, arrow up, arrow down and x, as paths. */
export const icons = {
  search: "M21 21l-4.34-4.34M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M19 12l-7 7-7-7",
  close: "M18 6 6 18M6 6l12 12",
};

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>>,
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, value);
  made.append(...children);
  return made;
}

export function button(
  label: string,
  title: string,
  run: () => void,
  children: readonly (Node | string)[],
) {
  const made = element("button", { type: "button", class: "cm-findButton", title }, children);
  if (label !== "") made.setAttribute("aria-label", label);
  made.addEventListener("click", run);
  return made;
}
