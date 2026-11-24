// What the interrupt hook reads of the stack (04-kernel §6): whether user code is on it (a cell's script, or the
// user-code frame below which the kernel calls user functions) through Node's call sites and, beyond 200 frames, V8's
// stack trace API; the frames of code outside the cells, the kernel and Node; the cell of the innermost cell frame.
// Error's statics, which the deeper read sets for one capture, are read and put back through their descriptors with
// the Error captured when the module loads: a cell's accessor there, or a replaced global Error, would be its code run
// inside the hook, so the deeper read is then not made (no termination is safer).
import { fileURLToPath } from "node:url";
import type { CallSiteObject } from "node:util";
import { getCallSites } from "node:util";

import type { CellId } from "@jsnb/core";

import type { FramePosition } from "./builtins/userCode.js";
import { samePosition } from "./builtins/userCode.js";
import { bare, holdsValue, isAccessor, ownDescriptor } from "./descriptors.js";

/** A cell's script is `jsnb:///<notebook>/<cell>.ts` (04-kernel §4, §9); no other script has this scheme. */
const cellScheme = "jsnb:///";

/** The most call sites Node's getCallSites returns. */
const siteLimit = 200;

/** The most frames a notice of code outside the cells names. */
const namedFrames = 10;

/** Error and its stack capture, captured when the module loads, before any cell can replace the global binding. */
const NativeError = Error;
const captureStackTrace = NativeError.captureStackTrace.bind(NativeError);
const { defineProperty, deleteProperty } = Reflect;

/** The statics V8's stack trace API reads. */
const statics = ["prepareStackTrace", "stackTraceLimit"] as const;

/** A frame of user code: a cell's script, or the user-code frame (`frame`) below which the kernel calls user code. */
const isUserFrame = (site: FramePosition, frame: FramePosition | undefined): boolean =>
  site.scriptName.startsWith(cellScheme) || (frame !== undefined && samePosition(site, frame));

/** A V8 CallSite as a FramePosition; a native frame has no script name. */
function positionOf(site: NodeJS.CallSite): FramePosition {
  const name: unknown = site.getScriptNameOrSourceURL();
  return {
    scriptName: typeof name === "string" ? name : "",
    lineNumber: site.getLineNumber() ?? 0,
    columnNumber: site.getColumnNumber() ?? 0,
  };
}

/**
 * The two statics V8's stack trace API reads, as they are, when the hook may set them for one read: own data
 * properties, or none, of the Error the global binding still holds (Node reads `globalThis.Error.prepareStackTrace`).
 * Undefined when the binding was replaced or either static is an accessor: a cell's code would run inside the hook.
 */
function settableStatics(): readonly (PropertyDescriptor | undefined)[] | undefined {
  if (!holdsValue(globalThis, "Error", NativeError)) return undefined;
  const saved = statics.map((key) => ownDescriptor(NativeError, key));
  return saved.some(isAccessor) ? undefined : saved;
}

/** Puts Error's statics back as `saved` read them: each descriptor, or none. */
function restoreStatics(saved: readonly (PropertyDescriptor | undefined)[]): void {
  statics.forEach((key, index) => {
    const descriptor = saved[index];
    if (descriptor) defineProperty(NativeError, key, descriptor);
    else deleteProperty(NativeError, key);
  });
}

/**
 * V8's whole stack, read beyond Node's 200 call sites through the stack trace API; false when it cannot be read without
 * running a cell's code (an accessor, a replaced Error) or Error's statics cannot be set (frozen).
 */
function userCodeDeeper(frame: FramePosition | undefined): boolean {
  const saved = settableStatics();
  if (saved === undefined) return false;
  const prepare = (_error: unknown, sites: readonly NodeJS.CallSite[]): boolean =>
    sites.some((site) => isUserFrame(positionOf(site), frame));
  const values = [prepare, Number.POSITIVE_INFINITY];
  const set = (key: (typeof statics)[number], index: number): boolean =>
    defineProperty(
      NativeError,
      key,
      bare({ value: values[index], writable: true, configurable: true }),
    );
  try {
    if (!statics.every(set)) return false;
    const holder: { stack?: unknown } = {};
    captureStackTrace(holder);
    return holder.stack === true;
  } finally {
    restoreStatics(saved);
  }
}

/**
 * True when a frame of user code is on the current synchronous stack, however deep below the caller: a cell's frame,
 * or `frame`, the user-code frame (undefined when it could not be calibrated: then cell frames only).
 */
export function userCodeOnStack(frame: FramePosition | undefined): boolean {
  const sites = getCallSites(siteLimit, { sourceMap: false });
  if (sites.some((site) => isUserFrame(site, frame))) return true;
  return sites.length === siteLimit && userCodeDeeper(frame);
}

/**
 * True when a frame's script is code outside the cells: not Node's own (`node:`), not a cell's, not a file under one of
 * the kernel's `directories`; a frame with no script (native, an evaluated expression) is not.
 */
export function isOutsideFrame(scriptName: string, directories: readonly string[]): boolean {
  if (scriptName === "" || scriptName.startsWith("node:") || scriptName.startsWith(cellScheme))
    return false;
  const path = pathOf(scriptName);
  return path === undefined || !directories.some((directory) => path.startsWith(directory));
}

/** The file path of a script name, a file URL or a path; undefined for a file URL that names no local path. */
function pathOf(scriptName: string): string | undefined {
  if (!scriptName.startsWith("file:")) return scriptName;
  try {
    return fileURLToPath(scriptName);
  } catch {
    // A file URL with a remote host: no file of the kernel's.
    return undefined;
  }
}

/** A frame as a notice names it: its function, when named, and its script position. */
function describeFrame(site: CallSiteObject): string {
  const at = `${site.scriptName}:${String(site.lineNumber)}:${String(site.columnNumber)}`;
  return site.functionName === "" ? at : `${site.functionName} (${at})`;
}

/**
 * The frames of code outside the cells on the current synchronous stack (Node's 200 call sites), innermost first, each
 * once, the first ten; empty when there is none.
 */
export function outsideFramesOnStack(directories: readonly string[]): readonly string[] {
  const frames = getCallSites(siteLimit, { sourceMap: false })
    .filter((site) => isOutsideFrame(site.scriptName, directories))
    .map(describeFrame);
  return [...new Set(frames)].slice(0, namedFrames);
}

/** The cell of the innermost cell frame on the current synchronous stack (Node's 200 call sites), by `cellOf`. */
export function cellOnStack(cellOf: (url: string) => CellId | undefined): CellId | undefined {
  const sites = getCallSites(siteLimit, { sourceMap: false });
  const cellSite = sites.find((site) => site.scriptName.startsWith(cellScheme));
  return cellSite === undefined ? undefined : cellOf(cellSite.scriptName);
}
