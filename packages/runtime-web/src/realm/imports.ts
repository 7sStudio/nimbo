// Client imports: the URL a specifier loads from, and the loader behind `__scope.__import`.

const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const isRelative = (specifier: string): boolean =>
  specifier === "." ||
  specifier === ".." ||
  specifier.startsWith("./") ||
  specifier.startsWith("../");

/**
 * The client import rule: a URL (`https:`, `data:`, `blob:` …) or a path from the root is used as it is; a relative
 * specifier travels as one escaped path segment under `/npm/` (no dot segment for the URL parser to collapse, and never
 * a package, since npm names cannot start with a dot); anything else is a package spec, `/npm/<spec>`.
 */
export function importUrl(specifier: string): string {
  if (scheme.test(specifier) || specifier.startsWith("/")) return specifier;
  if (isRelative(specifier)) return `/npm/${encodeURIComponent(specifier)}`;
  return `/npm/${specifier}`;
}

/** Loads a module by URL: the daemon bundles packages and serves relative files at `/npm/`. */
export async function loadModule(url: string): Promise<unknown> {
  const loaded: unknown = await import(/* @vite-ignore */ url);
  return loaded;
}
