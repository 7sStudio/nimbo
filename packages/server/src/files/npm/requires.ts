// The CommonJS requires of a package's bundle or of a workspace CommonJS file. esbuild
// leaves `__require("<url>")` for a require of an external, and its helper throws "Dynamic require … is not supported"
// where no `require` exists, as in every page. So such a module gets a prelude: a static import of each module a
// literal require names that resolves, and a module-scoped `require`, which esbuild's helper reads, answering with
// Node's interop (the module.exports of a module built from a CommonJS entry, else the namespace). Imported first, a
// required module evaluates before the requiring one's code, not at the call, as for debug and ms or react-dom and
// react, which require at their top. A module still evaluating (a cycle between two CommonJS packages) answers a view
// of its exports, read at each use and filled once it has run (not Node's partial exports while it runs); nothing
// waits, so nothing hangs. A literal require that does not resolve throws at the call as Node's MODULE_NOT_FOUND does,
// so an optional dependency in a try keeps working; a require of a name computed at run time throws RequireUnsupported,
// naming the module and what to do. A module built from a CommonJS entry marks itself. In a package's split bundle the
// helper sits in one output and the requires in others, so each output imports the modules its own code requires and
// adds them to the package's registry (a Map under a Symbol.for key of the package's URL on globalThis), which the
// output that defines the helper reads at each call: an entry never imports what only another entry requires.

/** One literal require of a bundle: the URL the bundle names it by, the name as written, and whether Node found it. */
export type Required = { readonly url: string; readonly spec: string; readonly found: boolean };

/** The export that tells a requiring bundle to take this bundle's default (module.exports). */
export const commonJsMark = "export const __nimboCjs = true;\n";

/** The module-scoped `require` of a bundle, as JavaScript that runs in the page. */
const requireOf = `((found, missing, from) => {
  const valueOf = (ns) => (ns.__nimboCjs === true && "default" in ns ? ns.default : ns);
  const exportsOf = (ns) => {
    try {
      return valueOf(ns);
    } catch {
      return new Proxy({}, { get: (_, key) => { try { return valueOf(ns)[key]; } catch { return undefined; } } });
    }
  };
  return (spec) => {
    const ns = found.get(spec);
    if (ns !== undefined) return exportsOf(ns);
    const name = missing.get(spec);
    const error = new Error(name === undefined
      ? from + " calls require(" + JSON.stringify(spec) + ") with a name computed at run time,"
        + " which the page cannot load: the daemon bundles only what a require names literally."
        + " Import that module in the cell, or use " + from + " from a server cell."
      : "Cannot find module '" + name + "'\\nRequire stack:\\n- " + from);
    error.name = name === undefined ? "RequireUnsupported" : "Error";
    if (name !== undefined) error.code = "MODULE_NOT_FOUND";
    throw error;
  };
})`;

/** Whether esbuild's output defines its `__require` helper, which calls the `require` in scope. */
const callsRequire = (text: string): boolean => /^var __require = /m.test(text);

/**
 * The prelude of the bundle `text` of `from`, which makes `requires`; empty when the bundle calls no `require` (a
 * require esbuild left, literal or computed, makes it define its helper, which then calls this `require`).
 */
export function requirePrelude(requires: readonly Required[], from: string, text: string): string {
  if (requires.length === 0 && !callsRequire(text)) return "";
  const urls = [...new Set(requires.filter((required) => required.found).map(({ url }) => url))];
  const imports = urls.map(
    (url, at) => `import * as __nimboRequired${String(at)} from ${JSON.stringify(url)};\n`,
  );
  const found = urls
    .map((url, at) => `[${JSON.stringify(url)}, __nimboRequired${String(at)}]`)
    .join(", ");
  const missing = requires
    .filter((required) => !required.found)
    .map(({ url, spec }) => `[${JSON.stringify(url)}, ${JSON.stringify(spec)}]`)
    .join(", ");
  const made = `const require = ${requireOf}(new Map([${found}]), new Map([${missing}]), ${JSON.stringify(from)});\n`;
  return `${imports.join("")}${made}`;
}

/** The registry of a split bundle's requires, the package's URL its key, as JavaScript that runs in the page. */
const registryOf = (base: string): string =>
  `(globalThis[Symbol.for(${JSON.stringify(`nimbo.require ${base}`)})] ??= new Map())`;

/**
 * The prelude of one output `text` of the split bundle of the package `from` served at `base`: an import of each
 * module its own code requires literally, added to the package's registry, and where it defines esbuild's helper, the
 * `require` that reads the registry; empty when it does neither.
 */
export function splitPrelude(
  requires: readonly Required[],
  pkg: { readonly name: string; readonly base: string },
  text: string,
): string {
  const urls = [
    ...new Set(
      requires
        .filter(({ found, url }) => found && text.includes(`__require(${JSON.stringify(url)})`))
        .map(({ url }) => url),
    ),
  ];
  const imports = urls.map(
    (url, at) => `import * as __nimboRequired${String(at)} from ${JSON.stringify(url)};\n`,
  );
  const added = urls.map((url, at) => `.set(${JSON.stringify(url)}, __nimboRequired${String(at)})`);
  const registered = added.length === 0 ? "" : `${registryOf(pkg.base)}${added.join("")};\n`;
  if (!callsRequire(text)) return `${imports.join("")}${registered}`;
  const missing = requires
    .filter((required) => !required.found)
    .map(({ url, spec }) => `[${JSON.stringify(url)}, ${JSON.stringify(spec)}]`)
    .join(", ");
  const made = `const require = ${requireOf}(${registryOf(pkg.base)}, new Map([${missing}]), ${JSON.stringify(pkg.name)});\n`;
  return `${imports.join("")}${registered}${made}`;
}
