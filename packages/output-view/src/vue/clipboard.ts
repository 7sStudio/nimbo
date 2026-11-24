// Copy and download: text to the clipboard and a Blob URL to a file, the browser APIs behind "copy" and "export".
import { toJSON } from "../model/export.js";

/** A value as "copy value" puts it on the clipboard: pretty JSON (refs resolved against `root`), no final newline. */
export const valueText = (json: unknown, root: unknown = json): string =>
  toJSON(json, root).trimEnd();

/** Writes text to the clipboard; false when the page may not (no permission, no clipboard). */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The browser refused (no focus, no permission, no clipboard API): nothing was copied, so no `copy` event follows.
    return false;
  }
}

/** Saves text or a Blob as a file through a temporary Blob URL and an <a download>. */
export function downloadFile(name: string, content: string | Blob, mime = "text/plain"): void {
  const blob = typeof content === "string" ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
