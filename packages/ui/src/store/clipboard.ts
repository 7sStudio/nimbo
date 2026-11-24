// A copy to the clipboard and the toast that says so (copies are toasts), or that it failed (a page the
// browser does not let write the clipboard). The text copied is the toast's line, so the user sees what they got.
import type { useUiStore } from "./ui.js";

/** Writes `text` and toasts `Copied <what>`, or `Could not copy`; true when it was written. */
export async function copyText(
  ui: Pick<ReturnType<typeof useUiStore>, "toast">,
  text: string,
  what: string,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    ui.toast({ kind: "success", title: `Copied ${what}`, text });
    return true;
  } catch {
    ui.toast({ kind: "error", title: "Could not copy", text });
    return false;
  }
}
