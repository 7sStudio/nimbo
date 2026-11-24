// The two screenshots of a feedback entry, taken from one capture of the page as the user saw it when they clicked: the
// viewport with the picked element (or the dragged box) outlined, and that element cropped with some margin around it.
// The feedback layer itself is left out. modern-screenshot redraws the DOM into a canvas (no browser permission).
// The copy of the DOM is the slow part (over a second on a notebook page): it yields to the page every few
// milliseconds and skips what lies outside the window, so the note can be typed into while it runs.
import { createContext, domToCanvas } from "modern-screenshot";

import type { Rect, Shots } from "../store/feedbackApi.js";

/** The PNG of `canvas` as base64, without the data URL's prefix. */
const base64Of = (canvas: HTMLCanvasElement): string =>
  canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/u, "");

/** The part of `source` (drawn at `scale`) inside `box`, with `margin` CSS pixels around it, clipped to the source. */
function crop(
  source: HTMLCanvasElement,
  box: Rect,
  scale: number,
  margin: number,
): HTMLCanvasElement | undefined {
  const x = Math.max(0, Math.floor((box.x - margin) * scale));
  const y = Math.max(0, Math.floor((box.y - margin) * scale));
  const right = Math.min(source.width, Math.ceil((box.x + box.width + margin) * scale));
  const bottom = Math.min(source.height, Math.ceil((box.y + box.height + margin) * scale));
  if (right - x < 2 || bottom - y < 2) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = right - x;
  canvas.height = bottom - y;
  canvas
    .getContext("2d")
    ?.drawImage(source, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Outlines `box` on `canvas` in the accent colour, so the viewport shot shows what the note is about. */
function outline(canvas: HTMLCanvasElement, box: Rect, scale: number, color: string): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.save();
  context.scale(scale, scale);
  context.lineWidth = 2;
  context.strokeStyle = color;
  context.setLineDash([]);
  context.strokeRect(box.x - 1, box.y - 1, box.width + 2, box.height + 2);
  context.restore();
}

function outside(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return (
    box.bottom <= 0 ||
    box.right <= 0 ||
    box.top >= window.innerHeight ||
    box.left >= window.innerWidth
  );
}

/** An element out of the window whose parent is out of it too: the parent's box keeps its place in the copy. */
const hidden = (node: Node): boolean =>
  node instanceof Element &&
  node.parentElement !== null &&
  outside(node) &&
  outside(node.parentElement);

const breathe = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/** The hidden frame modern-screenshot reads the browser's default styles from, loaded before the copy starts: the copy
 * gives the page back while it runs, and a frame left to load meanwhile would swap its document under it. */
async function sandbox(): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  frame.width = "0";
  frame.height = "0";
  frame.style.visibility = "hidden";
  frame.style.position = "fixed";
  frame.srcdoc = '<!DOCTYPE html><meta charset="UTF-8"><title></title><body>';
  const loaded = new Promise<void>((resolve) => {
    setTimeout(resolve, 2000);
    frame.addEventListener(
      "load",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  document.body.append(frame);
  await loaded;
  return frame;
}

const sliceMs = 12;

/** Empty shots when the capture failed (a cross-origin image, an unreadable canvas) or was cancelled. */
export async function capture(
  box: Rect,
  skip: (node: Node) => boolean,
  color: string,
  signal?: AbortSignal,
): Promise<Shots> {
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const frame = await sandbox();
  let since = performance.now();
  try {
    const context = await createContext(document.documentElement, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale,
      backgroundColor: getComputedStyle(document.body).backgroundColor || null,
      filter: (node) => node !== frame && !skip(node) && !hidden(node),
      features: { restoreScrollPosition: true },
      timeout: 10_000,
      onCloneEachNode: async () => {
        if (signal?.aborted === true) throw new Error("cancelled");
        if (performance.now() - since < sliceMs) return;
        await breathe();
        since = performance.now();
      },
    });
    context.sandbox = frame;
    const page = await domToCanvas(context);
    if (signal?.aborted === true) return {};
    const element = crop(page, box, scale, 16);
    outline(page, box, scale, color);
    return {
      viewport: base64Of(page),
      ...(element === undefined ? {} : { element: base64Of(element) }),
    };
  } catch {
    return {};
  } finally {
    frame.remove();
  }
}
