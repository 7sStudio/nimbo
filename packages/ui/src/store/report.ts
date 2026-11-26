// What the page shows for a failed call: a toast with a plain title and the error's name and message, with the one action that helps where
// there is one. Banner states (kernel exited, could not save, changed on disk, view only) come from events instead.
import { isJsnbError } from "@jsnb/core";

import type { NewToast, ToastAction } from "./toasts.js";

/** The way out the page offers per error name. */
const actions: Readonly<Record<string, ToastAction>> = {
  // 1010: the kernel would not stop; restarting it is the way out
  InterruptRefused: { label: "Restart kernel", command: "kernel.restart" },
  // 1007: the file changed on disk; the banner offers the same choices
  NotebookConflict: { label: "Reload from disk", command: "notebook.reload" },
  // -32603 SaveFailed: autosave retries; a forced save now is the user's retry
  SaveFailed: { label: "Retry", command: "notebook.save" },
};

/** The name the page shows: -32603 carries the named JsnbError in `data.name` (SaveFailed, NotebookBecameLink, …),
 * every other error is named by its catalogue name. */
function nameOf(error: { readonly name: string; readonly data?: unknown }): string {
  const named: unknown =
    typeof error.data === "object" && error.data !== null
      ? Reflect.get(error.data, "name")
      : undefined;
  return error.name === "InternalFailure" && typeof named === "string" ? named : error.name;
}

/** The name of a failed call's error as the page shows it, or undefined for one that is no JsnbError. */
export const errorName = (error: unknown): string | undefined =>
  isJsnbError(error) ? nameOf(error) : undefined;

/** Titles that read better than the catalogue name spelled out. */
const titles: Readonly<Record<string, string>> = {
  Unauthorized: "Not authorized",
  // the daemon answers NotebookNotFound for any notebook that is not open, closed or gone alike
  NotebookNotFound: "Notebook not open",
  SaveFailed: "Could not save",
  InterruptRefused: "Could not interrupt",
  NotebookConflict: "Changed on disk",
  PackagesNotAdded: "Could not add the packages",
  OutputQueryFailed: "The query failed",
};

/** `CellNotFound` → `Cell not found`. */
const spelledOut = (name: string): string => {
  const words = name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

/** The toast for `error`: a plain title, the message with the catalogue name (or the named failure -32603 carries)
 * kept in front of it for whoever reports it, and the action. */
export function errorToast(error: unknown): NewToast {
  if (!isJsnbError(error)) {
    const text = error instanceof Error ? error.message : String(error);
    return { kind: "error", title: "Something went wrong", text };
  }
  const name = nameOf(error);
  const action = actions[name];
  return {
    kind: "error",
    title: titles[name] ?? spelledOut(name),
    text: `${name}: ${error.message}`,
    ...(action === undefined ? {} : { action }),
  };
}
