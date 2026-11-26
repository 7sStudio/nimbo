// display.iframe: a sandboxed frame inside the cell's container, and its tokens.

/** No src: the cell writes the frame's document, so it must stay readable; the frame isolates CSS. */
const ownDocumentSandbox = "allow-same-origin allow-scripts allow-forms allow-modals allow-popups";

/** A src: the page runs, opens popups and cannot reach the notebook; same-origin stays opaque. */
const pageSandbox =
  "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox";

/** The HTML default height of an iframe. */
const defaultHeight = 150;

/** An http(s) src on another origin keeps its own origin (it cannot reach ours); anything else is opaque. */
function isCrossOrigin(src: string): boolean {
  try {
    const url = new URL(src, document.baseURI);
    const web = url.protocol === "http:" || url.protocol === "https:";
    return web && url.origin !== window.location.origin;
  } catch {
    // An unparsable src is not a cross-origin page: the frame stays opaque and fails to load it.
    return false;
  }
}

/** The sandbox tokens for a frame with this src. */
function sandboxFor(src: string | undefined): string {
  if (src === undefined) return ownDocumentSandbox;
  return isCrossOrigin(src) ? `${pageSandbox} allow-same-origin` : pageSandbox;
}

const field = (options: unknown, key: string): unknown =>
  typeof options === "object" && options !== null ? Reflect.get(options, key) : undefined;

/** `{ src?, height? }`; unknown keys and values of the wrong type are ignored. */
export function createFrame(options: unknown): HTMLIFrameElement {
  const src = field(options, "src");
  const height = field(options, "height");
  const frame = document.createElement("iframe");
  const source = typeof src === "string" ? src : undefined;
  frame.setAttribute("sandbox", sandboxFor(source));
  frame.setAttribute("width", "100%");
  frame.setAttribute(
    "height",
    String(typeof height === "number" && Number.isFinite(height) ? height : defaultHeight),
  );
  if (source !== undefined) frame.setAttribute("src", source);
  return frame;
}
