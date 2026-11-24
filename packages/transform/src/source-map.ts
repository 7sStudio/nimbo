// The emitted JavaScript and its v3 map, made the kernel's: the map relocated to the cell URL and inlined after `//# sourceURL`.

export type EmittedCell = {
  readonly code: string;
  readonly map: string;
};

/** Base64 of the UTF-8 bytes of `text` without `Buffer`: the package runs in the browser too (02 §2). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)));
  }
  return btoa(chunks.join(""));
}

/** Drops the emitter's own `//# sourceMappingURL` line and the `export {};` the ESM transformer appends to a module. */
function stripTrailer(js: string): string {
  return js.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, "\n").replace(/\nexport \{\};\n$/, "\n");
}

/**
 * The map's only source: the cell URL as a `file:` URL. A debugger that finds the script's own URL as its source
 * (js-debug) shows the compiled script and binds breakpoints in it; a file-style source is the TypeScript.
 */
export function sourceOf(filename: string): string {
  return filename.replace(/^jsnb:\/\/\//, "file:///");
}

/** `file` becomes the cell URL, the only source its `file:` form; `sourceRoot` goes, `sourcesContent` stays. */
function relocateMap(mapJson: string, filename: string): string {
  const parsed: unknown = JSON.parse(mapJson);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("the emitter produced no source map");
  const map: Record<string, unknown> = {
    ...parsed,
    file: filename,
    sources: [sourceOf(filename)],
  };
  delete map.sourceRoot;
  return JSON.stringify(map);
}

/** The code the kernel compiles (04 §4 step 3): the script, `//# sourceURL=<filename>` and the inline map. */
export function assembleCell(js: string, mapJson: string, filename: string): EmittedCell {
  const map = relocateMap(mapJson, filename);
  const trailer = `//# sourceURL=${filename}\n//# sourceMappingURL=data:application/json;base64,${toBase64(map)}\n`;
  return { code: `${stripTrailer(js)}${trailer}`, map };
}
