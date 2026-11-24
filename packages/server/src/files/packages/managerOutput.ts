// Package managers print the decisive error first and noise after it (npm's log path, pnpm's help, a stack), so the
// first error block is kept apart from the last lines.

// pnpm 12 (`Error: ERR_PNPM_X`), older pnpm (` ERR_PNPM_X  text`), npm (`npm error`, `npm ERR!`), yarn classic
// (`error …`), yarn berry (YN codes; YN0000 is its info line), bun (`error: …`).
const errorStart =
  /^\s*(?:Error: |error:? )|\bERR_PNPM_[A-Z0-9_]+|^npm (?:error|ERR!) |\bYN0(?!000)\d{3}:/u;

const decoration = /^(?:npm (?:error|ERR!)|[\s×│├╰─▶➤]|help:)+/u;

const noise =
  /^(?:code|syscall|errno|path|type|requiredBy|dest)\b|^at |^A complete log|^[{}]?$|^If you need the full list/u;

const blockLines = 12;
const tailLines = 20;

export class ManagerOutput {
  readonly #tail: string[] = [];
  #block: string[] | undefined;

  push(line: string): void {
    this.#tail.push(line);
    if (this.#tail.length > tailLines) this.#tail.shift();
    if (this.#block === undefined) {
      if (errorStart.test(line)) this.#block = [line];
    } else if (this.#block.length < blockLines) this.#block.push(line);
  }

  tail(count: number): string {
    return this.#tail.slice(-count).join("\n");
  }

  /** The whole first error block, for matching a remedy; empty when the manager printed none. */
  block(): string {
    return (this.#block ?? []).join("\n");
  }

  /** The first error block on one line, its code first; undefined when the manager printed none. */
  reason(): string | undefined {
    if (this.#block === undefined) return undefined;
    const code = codeOf(this.#block);
    const items = itemsOf(this.#block).filter(
      (item) => item.text !== code && !noise.test(item.text) && !/^\d+$/u.test(item.text),
    );
    // pnpm's `×` line says what it was doing, the next one why it failed
    const shown = items[0]?.context === true ? items.slice(0, 2) : items.slice(0, 1);
    const text = shown.map((item) => item.text).join(": ");
    const short = text.length > 400 ? `${text.slice(0, 399)}…` : text;
    if (code === undefined) return short === "" ? undefined : short;
    return short === "" ? code : `${code}: ${short}`;
  }
}

/** pnpm wraps one message over `│` lines and starts the next at `×`, `─▶` or `help:`; npm's every line is its own. */
function itemsOf(block: readonly string[]): { text: string; context: boolean }[] {
  const items: { text: string; context: boolean }[] = [];
  for (const line of block) {
    const text = line
      .replace(decoration, "")
      .replace(/^(?:Error: |error: |notarget )/u, "")
      .replace(/\s+/gu, " ")
      .trim();
    const last = items.at(-1);
    if (text === "") continue;
    // piped, pnpm wraps at 80 columns: an indented line without a glyph of its own goes on the one before
    const wrapped = /^\s/u.test(line) && !/^\s*(?:[×├╰]|help:)/u.test(line);
    if (wrapped && last !== undefined)
      last.text = last.text.endsWith("-") ? `${last.text}${text}` : `${last.text} ${text}`;
    else items.push({ text, context: /^\s*×/u.test(line) });
  }
  for (const item of items) item.text = item.text.replace(/[.:]$/u, "");
  return items;
}

function codeOf(block: readonly string[]): string | undefined {
  const text = block.join("\n");
  return (
    /\bERR_PNPM_[A-Z0-9_]+/u.exec(text)?.[0] ??
    /^npm (?:error|ERR!) code (\S+)/mu.exec(text)?.[1] ??
    /\bYN\d{4}\b/u.exec(text)?.[0]
  );
}

// First match wins: an immature version before a missing one, a refused login before a 404.
const remedies: readonly (readonly [RegExp, string])[] = [
  [
    /NO_MATURE_MATCHING_VERSION|minimumReleaseAge/iu,
    "The versions that match were published too recently for the minimumReleaseAge setting: name an older version, or wait.",
  ],
  [
    /\bETARGET\b|NO_MATCHING_VERSION|No matching version/iu,
    "No published version matches: check the version or tag after the @.",
  ],
  [
    /\bE40[13]\b|FETCH_40[13]|\b40[13] (?:Unauthorized|Forbidden)\b/iu,
    "The registry refused access: check the login or token for it in .npmrc.",
  ],
  [
    /\bE404\b|FETCH_404|\b404\b|Package not found|\bnot (?:found|in this registry)\b/iu,
    "Check the package name: the registry has no package by that name.",
  ],
  [
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ENETUNREACH|Connection refused|dns error|getaddrinfo|error sending request|timed out|META_FETCH_FAIL/iu,
    "The registry could not be reached: check the network, a proxy, or the registry set in .npmrc, then try again.",
  ],
  [
    /\bERESOLVE\b|PEER_DEP|peer dep/iu,
    "Its peer dependencies conflict with the workspace's: add a version that fits them.",
  ],
  [
    /IGNORED_BUILDS|approve-builds/iu,
    "Its install scripts were not allowed to run: approve them with `pnpm approve-builds` in the workspace, then install again.",
  ],
  [
    /EBADENGINE|UNSUPPORTED_ENGINE|Unsupported engine/iu,
    "It needs another Node or package manager version than the workspace has.",
  ],
  [
    /\bE(?:ACCES|PERM)\b/u,
    "The package manager may not write there: check the folder's permissions.",
  ],
  [/\bENOSPC\b/u, "The disk is full: free some space, then try again."],
];

export function remedyFor(reason: string): string | undefined {
  return remedies.find(([pattern]) => pattern.test(reason))?.[1];
}
