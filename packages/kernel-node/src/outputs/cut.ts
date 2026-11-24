// Caps text at a number of UTF-16 units with a trailing … (the repr and preview caps of 04-kernel §5.2), never
// splitting a surrogate pair.

/** `text` itself when it fits `max`, else its first `max - 1` units and `…`, so the result is at most `max` long. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}
