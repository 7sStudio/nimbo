// The Secrets panel's usage count: how many cells name a secret through the kernel's env
// proxy (04-kernel §8), `env.NAME`, `env["NAME"]` or `env.has("NAME")`; the page's count of cells, not the kernel's
// reads. A bare word match would count a secret named PORT in every comment; `process.env.NAME` is Node's own
// environment, not the proxy, and is not counted.

const escaped = (name: string) => name.replace(/[$]/gu, "\\$&");

/** Whether `source` names `name` through env. */
export function readsSecret(source: string, name: string): boolean {
  const n = escaped(name);
  const quoted = `(?:"${n}"|'${n}'|\`${n}\`)`;
  return new RegExp(
    `(?<![\\w$.])env\\s*(?:\\??\\.\\s*${n}\\b|\\??\\.?\\[\\s*${quoted}\\s*\\]|\\.\\s*has\\s*\\(\\s*${quoted}\\s*\\))`,
    "u",
  ).test(source);
}

/** The 1-based numbers of the code cells that name `name` through env, in notebook order. */
export const readersOf = (
  cells: readonly { readonly type: string; readonly source: string }[],
  name: string,
): readonly number[] =>
  cells.flatMap((cell, at) =>
    cell.type !== "markdown" && readsSecret(cell.source, name) ? [at + 1] : [],
  );
