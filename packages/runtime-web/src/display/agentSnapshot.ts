// A container as an agent reads it (cell.snapshot, 03-api §4.3). `text` is the accessible text in reading order (form
// controls as their values, images as their alt text, hidden parts, scripts and styles left out, a block per line).
// `html`, only when asked for, is serialised here from an allowlist: allowlisted HTML and SVG elements with
// allowlisted attributes, URLs only http, https, mailto or relative, text and values escaped, so parsing it again runs
// nothing; comments, raw-text and embedding elements go with their content, unknown elements leave only their
// children. Both walks are iterative and bounded (nodes, depth, `maxBytes`), and yield to the page as they go.
import {
  allowedAttribute,
  droppedWithContent,
  emittedElement,
  isVoid,
} from "./snapshotAllowlist.js";

export type AgentSnapshot = {
  readonly text: string;
  readonly html?: string;
  readonly truncated: boolean;
};

const maxNodes = 20_000;
const maxDepth = 200;
const nodesPerSlice = 1000;

type Visitor = {
  /** "children" walks into the element, "skip" leaves it whole. */
  readonly enter: (element: Element) => "children" | "skip";
  readonly leave: (element: Element) => void;
  readonly text: (node: Text) => void;
  /** True once the output reached its budget. */
  readonly full: () => boolean;
};

type Frame = { readonly element: Element; next: Node | null };

// node types, not instanceof: a same-origin frame's nodes come from another realm
const isText = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;
const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

const yieldToPage = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** The first child the walk reads: a same-origin frame's body's, else the element's own. */
const firstOf = (element: Element): Node | null =>
  element instanceof HTMLIFrameElement
    ? (element.contentDocument?.body.firstChild ?? null)
    : element.firstChild;

/** One node of the walk: text to the visitor, an element entered unless it is past the depth budget (true then). */
function visit(stack: Frame[], node: Node, visitor: Visitor): boolean {
  if (isText(node)) visitor.text(node);
  if (!isElement(node)) return false;
  if (stack.length > maxDepth) return true;
  if (visitor.enter(node) === "children") stack.push({ element: node, next: firstOf(node) });
  return false;
}

/** Walks `root`'s descendants depth first without recursion; true when a budget cut it short. */
async function walk(root: Element, visitor: Visitor): Promise<boolean> {
  const stack: Frame[] = [{ element: root, next: root.firstChild }];
  let nodes = 0;
  let cut = false;
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const node = top.next;
    if (node === null) {
      stack.pop();
      if (stack.length > 0) visitor.leave(top.element);
      continue;
    }
    top.next = node.nextSibling;
    nodes += 1;
    if (nodes > maxNodes || visitor.full()) return true;
    if (nodes % nodesPerSlice === 0) await yieldToPage();
    if (visit(stack, node, visitor)) cut = true;
  }
  return cut;
}

const blocks = new Set(
  "address article aside blockquote br dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tr ul caption legend option".split(
    " ",
  ),
);

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
  return blocks.has(element.localName) || element instanceof SVGTextElement;
}

/** What an input says: its value (its placeholder in brackets when empty), a box's state; nothing for a secret. */
function inputText(input: HTMLInputElement): string {
  if (input.type === "hidden" || input.type === "password") return "";
  if (input.type === "checkbox" || input.type === "radio") return `[${input.checked ? "x" : " "}]`;
  const empty = input.value === "" && input.type !== "button" && input.type !== "submit";
  return empty && input.placeholder !== "" ? `[${input.placeholder}]` : input.value;
}

/** What a form control, a progress bar, a meter or an image says. */
function controlText(element: Element): string | undefined {
  if (element instanceof HTMLInputElement) return inputText(element);
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement)
    return [...element.selectedOptions].map((option) => option.text).join(", ");
  if (element instanceof HTMLProgressElement || element instanceof HTMLMeterElement)
    return `[${String(element.value)}/${String(element.max)}]`;
  return element instanceof HTMLImageElement ? element.alt : undefined;
}

function textVisitor(maxBytes: number, out: string[]): Visitor {
  let length = 0;
  const push = (part: string): void => {
    out.push(part);
    length += part.length;
  };
  return {
    enter: (element) => {
      if (hidden(element)) return "skip";
      if (element instanceof HTMLIFrameElement) return "children";
      if (droppedWithContent(element)) return "skip";
      if (isBlock(element)) push("\n");
      const control = controlText(element);
      const label = element.getAttribute("aria-label");
      if (control !== undefined) push(` ${control} `);
      else if (label !== null && element.firstChild === null) push(` ${label} `);
      else return "children";
      if (isBlock(element)) push("\n");
      return "skip";
    },
    leave: (element) => {
      if (isBlock(element)) push("\n");
    },
    text: (node) => {
      push(node.data.replace(/\s+/gu, " "));
    },
    full: () => length > maxBytes,
  };
}

const escapeText = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeValue = (text: string): string => escapeText(text).replaceAll('"', "&quot;");

/** The live state of a form control, which its markup may not say: a box's check, an input's value (a typed password
 * as ***), an option's selection. */
function formState(element: Element): string {
  if (element instanceof HTMLOptionElement) return element.selected ? ' selected=""' : "";
  if (!(element instanceof HTMLInputElement)) return "";
  if (element.type === "checkbox" || element.type === "radio")
    return element.checked ? ' checked=""' : "";
  if (element.type === "password") return element.value === "" ? "" : ' value="***"';
  return element.type === "file" ? "" : ` value="${escapeValue(element.value)}"`;
}

/** Markup attributes the live state stands for instead. */
const stateful = (element: Element, name: string): boolean =>
  (element instanceof HTMLInputElement && (name === "value" || name === "checked")) ||
  (element instanceof HTMLOptionElement && name === "selected");

/** The element's attributes as the HTML says them: allowlisted ones, with the live form state written in. */
function attributesOf(element: Element): string {
  const parts: string[] = [];
  for (const attribute of element.attributes) {
    if (stateful(element, attribute.name)) continue;
    if (allowedAttribute(element, attribute.name, attribute.value))
      parts.push(` ${attribute.name}="${escapeValue(attribute.value)}"`);
  }
  return parts.join("") + formState(element);
}

function htmlVisitor(maxBytes: number, out: string[]): Visitor {
  let length = 0;
  const push = (part: string): void => {
    out.push(part);
    length += part.length;
  };
  const open = new WeakSet<Element>();
  return {
    enter: (element) => {
      if (droppedWithContent(element)) return "skip";
      const kind = emittedElement(element);
      if (kind === "skip") return "skip";
      if (kind === "unwrap") return "children";
      push(`<${element.localName}${attributesOf(element)}>`);
      if (isVoid(element)) return "skip";
      if (element instanceof HTMLTextAreaElement) {
        push(`${escapeText(element.value)}</textarea>`);
        return "skip";
      }
      open.add(element);
      return "children";
    },
    leave: (element) => {
      if (open.has(element)) push(`</${element.localName}>`);
    },
    text: (node) => {
      push(escapeText(node.data));
    },
    full: () => length > maxBytes,
  };
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

const lines = (parts: readonly string[]): string =>
  parts
    .join("")
    .split("\n")
    .map((line) => line.replace(/ +/gu, " ").trim())
    .filter((line) => line !== "")
    .join("\n");

export async function agentSnapshot(
  container: Element,
  options: { readonly maxBytes: number; readonly html: boolean },
): Promise<AgentSnapshot> {
  const { maxBytes } = options;
  const textParts: string[] = [];
  const textWalkCut = await walk(container, textVisitor(maxBytes, textParts));
  const text = cut(lines(textParts), maxBytes);
  if (!options.html) return { text: text.text, truncated: textWalkCut || text.cut };
  const htmlParts: string[] = [];
  const htmlWalkCut = await walk(container, htmlVisitor(maxBytes, htmlParts));
  const html = cut(htmlParts.join(""), maxBytes);
  const truncated = textWalkCut || text.cut || htmlWalkCut || html.cut;
  return { text: text.text, html: html.text, truncated };
}
