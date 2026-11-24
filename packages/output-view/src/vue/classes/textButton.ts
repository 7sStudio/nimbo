// A button that reads as a word (a hint's action, "Show all", "Load next", Cancel, the query notes' exports): no frame,
// 11 px in the client's color, a pale wash under a pointer. Its fade is chrome.css's, which reduced motion turns off.
const base =
  "ov:cursor-pointer ov:rounded-small ov:border-0 ov:bg-transparent ov:px-1 ov:py-0 ov:font-sans ov:text-meta";

export const textButton = `${base} ov:text-client ov:hover:bg-client-soft`;

/** A hint's date: a word in the secondary color whose tooltip holds both forms; it takes no wash. */
export const timeButton = `${base} ov:text-fg-2`;
