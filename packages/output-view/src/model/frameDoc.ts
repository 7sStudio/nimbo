// The document a sandboxed frame shows for a cell's own HTML (a server cell's display.html, a client cell's DOM
// snapshot): the markup after a head that lets the frame take the page's light or dark scheme and
// keep its canvas clear, so the markup sits on the surface under it (the result's tone) in either theme instead of a
// white band in the dark one. Markup that sets its own background still has it: its rules come after these.

/** `html` as the srcdoc of a sandboxed frame that follows the page's theme. */
export const frameDoc = (html: string): string =>
  `<meta name="color-scheme" content="light dark"><style>:root{color-scheme:light dark;background:transparent}</style>${html}`;
