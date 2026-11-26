// What packages.search sends the registry: words, never a path or a URL.

/** A search query: words of letters, digits, `-`, `_`, `.` and spaces, with one `@scope/` in front at most. Never a
 * path or a URL (no `:`, backslash, `~`, nor a `/` but the scope's), so a local folder typed in a search field stays
 * on the machine. */
export const packageQueryPattern = /^(?:@[\p{L}\p{N}._-]+\/)?[\p{L}\p{N}._ -]+$/u;

/** Whether `text` may be sent to the registry as a search. */
export const isPackageQuery = (text: string): boolean =>
  text.trim() !== "" && packageQueryPattern.test(text.trim());
