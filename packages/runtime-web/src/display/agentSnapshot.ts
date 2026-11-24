// A container as an agent reads it (cell.snapshot, 03-api §4.3): `text` is the accessible text in reading order (form
// controls as their values, images as their alt text, hidden parts left out, a block per line), `html` a copy with no
// script, style or event handler and the live form values written as attributes; each cut to `maxBytes` of UTF-8.

export type AgentSnapshot = {
  readonly html: string;
  readonly text: string;
  readonly truncated: boolean;
};

const dropped = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"]);
const blocks = new Set([
  ..."ADDRESS ARTICLE ASIDE BLOCKQUOTE BR DD DETAILS DIALOG DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM".split(
    " ",
  ),
  ..."H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION SUMMARY TABLE TR UL CAPTION LEGEND OPTION".split(
    " ",
  ),
]);
const urlAttributes = new Set(["href", "src", "action", "formaction", "xlink:href"]);

function hidden(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden")) return true;
  return element.isConnected && element instanceof HTMLElement && !element.checkVisibility();
}

function isBlock(element: Element): boolean {
  if (element.isConnected && element instanceof HTMLElement) {
    const display = getComputedStyle(element).display;
    if (display !== "" && !display.startsWith("inline") && display !== "contents") return true;
  }
  // a chart's SVG labels read one per line
  return blocks.has(element.tagName) || element instanceof SVGTextElement;
}

/** What an input says: its value (its placeholder in brackets when empty), a box's state; nothing for a secret. */
function inputText(input: HTMLInputElement): string {
  if (input.type === "hidden" || input.type === "password") return "";
  if (input.type === "checkbox" || input.type === "radio") return `[${input.checked ? "x" : " "}]`;
  const empty = input.value === "" && input.type !== "button" && input.type !== "submit";
  return empty && input.placeholder !== "" ? `[${input.placeholder}]` : input.value;
}

/** What a form control, a progress bar, a meter or an image says: its value, a select's chosen options, a bar's
 * `value/max`, an image's alt text. */
function controlText(element: Element): string | undefined {
  if (element instanceof HTMLInputElement) return inputText(element);
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement)
    return [...element.selectedOptions].map((option) => option.text).join(", ");
  if (element instanceof HTMLProgressElement || element instanceof HTMLMeterElement)
    return `[${String(element.value)}/${String(element.max)}]`;
  return element instanceof HTMLImageElement ? element.alt : undefined;
}

/** An element's own text: a control's, a same-origin frame's body, a label-only element's aria-label, or its children's. */
function inner(element: Element, out: string[]): void {
  const control = controlText(element);
  if (control !== undefined) {
    out.push(` ${control} `);
    return;
  }
  if (element instanceof HTMLIFrameElement) {
    const body = element.contentDocument?.body;
    if (body) collect(body, out);
    return;
  }
  const label = element.getAttribute("aria-label");
  if (label !== null && element.textContent.trim() === "") out.push(` ${label} `);
  else for (const child of element.childNodes) collect(child, out);
}

function collect(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.textContent ?? "").replace(/\s+/gu, " "));
    return;
  }
  if (!(node instanceof Element) || dropped.has(node.tagName) || hidden(node)) return;
  const block = isBlock(node);
  if (block) out.push("\n");
  inner(node, out);
  if (block) out.push("\n");
}

/** The accessible text of `root`, one block per line. */
function accessibleText(root: Element): string {
  const out: string[] = [];
  for (const child of root.childNodes) collect(child, out);
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/ +/gu, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** Writes the live form state of `live` on the copy `copy` as attributes, so the HTML says what the user sees. */
function writeFormState(live: Element, copy: Element): void {
  if (live instanceof HTMLInputElement) {
    if (live.type === "checkbox" || live.type === "radio")
      copy.toggleAttribute("checked", live.checked);
    else if (live.type !== "password" && live.type !== "file")
      copy.setAttribute("value", live.value);
  } else if (live instanceof HTMLTextAreaElement) copy.textContent = live.value;
  else if (live instanceof HTMLOptionElement) copy.toggleAttribute("selected", live.selected);
}

function clean(element: Element): void {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    const scripted = urlAttributes.has(name) && /^\s*javascript:/iu.test(attribute.value);
    if (name.startsWith("on") || name === "srcdoc" || scripted)
      element.removeAttribute(attribute.name);
  }
}

/** A copy of `root`'s children without scripts or handlers, with the live form values. */
function sanitizedHtml(root: Element): string {
  const copy = root.cloneNode(true);
  if (!(copy instanceof Element)) return "";
  const lives = [...root.querySelectorAll("*")];
  const copies = [...copy.querySelectorAll("*")];
  lives.forEach((live, at) => {
    const twin = copies[at];
    if (twin) writeFormState(live, twin);
  });
  for (const element of copies) {
    if (dropped.has(element.tagName)) element.remove();
    else clean(element);
  }
  return copy.innerHTML;
}

const encoder = new TextEncoder();

/** `text` cut to at most `maxBytes` of UTF-8, at a character boundary. */
function cut(text: string, maxBytes: number): { readonly text: string; readonly cut: boolean } {
  if (encoder.encode(text).length <= maxBytes) return { text, cut: false };
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, mid)).length <= maxBytes) low = mid;
    else high = mid - 1;
  }
  const last = text.charCodeAt(low - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? low - 1 : low;
  return { text: text.slice(0, end), cut: true };
}

export function agentSnapshot(container: Element, maxBytes: number): AgentSnapshot {
  const html = cut(sanitizedHtml(container), maxBytes);
  const text = cut(accessibleText(container), maxBytes);
  return { html: html.text, text: text.text, truncated: html.cut || text.cut };
}
