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
  imageNote,
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
      const room = maxBytes - length + 1;
      if (control !== undefined) push(` ${control.slice(0, room)} `);
      else if (label !== null && element.firstChild === null) push(` ${label.slice(0, room)} `);
      else return "children";
      if (isBlock(element)) push("\n");
      return "skip";
    },
    leave: (element) => {
      if (isBlock(element)) push("\n");
    },
    text: (node) => {
      push(node.data.slice(0, maxBytes - length + 1).replace(/\s+/gu, " "));
    },
    full: () => length > maxBytes,
  };
}

const escapeText = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeValue = (text: string): string => escapeText(text).replaceAll('"', "&quot;");

const encoder = new TextEncoder();
const bytesOf = (text: string): number => encoder.encode(text).length;

/** The longest prefix of `raw` (read no further than `room` characters) whose escaped form fits `room` bytes. */
function fitted(
  raw: string,
  room: number,
  escape: (text: string) => string,
): { text: string; cut: boolean } {
  if (room <= 0) return { text: "", cut: raw !== "" };
  const head = raw.slice(0, room);
  if (bytesOf(escape(head)) <= room) return { text: escape(head), cut: head.length < raw.length };
  let low = 0;
  let high = head.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (bytesOf(escape(head.slice(0, mid))) <= room) low = mid;
    else high = mid - 1;
  }
  const last = head.charCodeAt(low - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? low - 1 : low;
  return { text: escape(head.slice(0, end)), cut: true };
}

/** The live value of a form control that its markup may not say, as [name, value]: a box's check, an input's value (a
 * typed password as ***), an option's selection; undefined for none. */
function formState(element: Element): readonly [string, string] | undefined {
  if (element instanceof HTMLOptionElement) return element.selected ? ["selected", ""] : undefined;
  if (!(element instanceof HTMLInputElement)) return undefined;
  if (element.type === "checkbox" || element.type === "radio")
    return element.checked ? ["checked", ""] : undefined;
  if (element.type === "password") return element.value === "" ? undefined : ["value", "***"];
  return element.type === "file" ? undefined : ["value", element.value];
}

/** Markup attributes the live state stands for instead. */
const stateful = (element: Element, name: string): boolean =>
  (element instanceof HTMLInputElement && (name === "value" || name === "checked")) ||
  (element instanceof HTMLOptionElement && name === "selected");

/** The element's attributes as [name, value]: allowlisted ones, each read no further than `room`, then the live form
 * state. */
function attributesOf(element: Element, room: number): (readonly [string, string])[] {
  const list: (readonly [string, string])[] = [];
  for (const attribute of element.attributes) {
    if (stateful(element, attribute.name)) continue;
    const value = attribute.value.slice(0, room + 1);
    if (allowedAttribute(element, attribute.name, value)) list.push([attribute.name, value]);
  }
  const state = formState(element);
  if (state) list.push([state[0], state[1].slice(0, room + 1)]);
  return list;
}

/**
 * The HTML, always well formed: a tag is written whole with room kept for every close tag still owed, an attribute
 * value or a text is cut to the room left (`cut`), and the walk stops once nothing more fits.
 */
function htmlVisitor(maxBytes: number) {
  const out: string[] = [];
  const closes: string[] = [];
  let used = 0;
  let owed = 0;
  let full = false;
  let cut = false;
  const open = new WeakSet<Element>();
  const room = (): number => maxBytes - used - owed;
  const push = (part: string): void => {
    out.push(part);
    used += bytesOf(part);
  };
  /** `<name a="…">`, its values cut to fit, or undefined when even the bare tag and its close do not fit. */
  const tagOf = (element: Element, close: string): string | undefined => {
    const name = element.localName;
    let tag = `<${name}`;
    let left = room() - bytesOf(`<${name}>`) - bytesOf(close);
    if (left < 0) return undefined;
    for (const [key, value] of attributesOf(element, left)) {
      const frame = bytesOf(` ${key}=""`);
      if (frame > left) {
        cut = true;
        break;
      }
      const fit = fitted(value, left - frame, escapeValue);
      if (fit.cut) cut = true;
      tag += ` ${key}="${fit.text}"`;
      left -= frame + bytesOf(fit.text);
    }
    return `${tag}>`;
  };
  const visitor: Visitor = {
    enter: (element) => {
      if (droppedWithContent(element)) return "skip";
      const kind = emittedElement(element);
      if (kind === "skip") return "skip";
      if (kind === "unwrap") return "children";
      const image = imageNote(element);
      if (image !== undefined) {
        visitor.text(document.createTextNode(image));
        return "skip";
      }
      const close = isVoid(element) ? "" : `</${element.localName}>`;
      const tag = tagOf(element, close);
      if (tag === undefined) {
        full = true;
        return "skip";
      }
      push(tag);
      if (close === "") return "skip";
      if (element instanceof HTMLTextAreaElement) {
        const fit = fitted(element.value, room() - bytesOf(close), escapeText);
        if (fit.cut) full = true;
        push(`${fit.text}${close}`);
        return "skip";
      }
      closes.push(close);
      open.add(element);
      owed += bytesOf(close);
      return "children";
    },
    leave: (element) => {
      if (!open.delete(element)) return;
      const close = closes.pop() ?? "";
      owed -= bytesOf(close);
      push(close);
    },
    text: (node) => {
      const fit = fitted(node.data, room(), escapeText);
      if (fit.cut) full = true;
      push(fit.text);
    },
    full: () => full,
  };
  /** The HTML with every close tag still owed. */
  const html = (): string => [...out, ...closes.toReversed()].join("");
  return { visitor, html, cut: () => cut || full };
}

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
  const writer = htmlVisitor(maxBytes);
  const htmlWalkCut = await walk(container, writer.visitor);
  const truncated = textWalkCut || text.cut || htmlWalkCut || writer.cut();
  return { text: text.text, html: writer.html(), truncated };
}
