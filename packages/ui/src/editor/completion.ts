// Completions in the editor (⌃Space): the language service's, through
// @codemirror/lsp-client once its chunk is loaded and the editor has the plugin; the words of the notebook and the
// names its cells import and define otherwise, and whenever the service answers nothing or fails (off, starting, gone).
import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";

/** Identifiers in `sources`, at least three characters, each once, sorted. */
export function wordsOf(sources: readonly string[]): readonly string[] {
  const found = new Set<string>();
  for (const source of sources)
    for (const match of source.matchAll(/[A-Za-z_$][\w$]{2,}/gu)) found.add(match[0]);
  return [...found].sort();
}

/** The names `import` statements bring in (`import x`, `import { a, b as c }`, `import * as d`). */
export function importNamesOf(sources: readonly string[]): readonly string[] {
  const names = new Set<string>();
  const clauses = sources.flatMap((source) =>
    [...source.matchAll(/\bimport\s+([^;'"]+?)\s+from\b/gu)].map(([, clause = ""]) => clause),
  );
  for (const part of clauses.flatMap((clause) => clause.replace(/[{}*]/gu, ",").split(","))) {
    const name =
      part
        .trim()
        .split(/(?:^|\s)as\s+/u)
        .at(-1)
        ?.trim() ?? "";
    if (/^[A-Za-z_$][\w$]*$/u.test(name)) names.add(name);
  }
  return [...names];
}

/** A word to complete and what it is, said at the row's end: "import" for a name an import brings in, "name" for an
 * identifier the notebook's cells hold. */
export type Word = { readonly label: string; readonly detail: "import" | "name" };

/** The notebook's import names, then its other words, each once (cells/useCells.ts gives them to the editors). */
export function completionWords(sources: readonly string[]): readonly Word[] {
  const imports = importNamesOf(sources);
  const taken = new Set(imports);
  return [
    ...imports.map((label): Word => ({ label, detail: "import" })),
    ...wordsOf(sources)
      .filter((label) => !taken.has(label))
      .map((label): Word => ({ label, detail: "name" })),
  ];
}

let server: CompletionSource | undefined;

/** The language service's source (editor/language/host.ts sets it when its chunk loads). */
export function setServerCompletion(source: CompletionSource): void {
  server = source;
}

/** How long the editor waits for the service before it offers the words (a cold start, a large package's types). */
const serverWaitMs = 1000;

/** After a member access (`Array.`, `order?.`): only the service knows the members; the notebook's words are not. */
const afterDot = (context: CompletionContext): boolean => {
  const word = context.matchBefore(/[\w$]*/u);
  return context.state.sliceDoc((word?.from ?? context.pos) - 1, word?.from ?? context.pos) === ".";
};

/** The service's completions, else the words: its answer null (no plugin, nothing to offer), failed or slow. After a
 * dot the words are never offered, and the service is waited for however long it takes (a large package's types). */
export function wordCompletion(words: () => readonly Word[]) {
  const fallback = wordsCompletion(words);
  return (
    context: CompletionContext,
  ): CompletionResult | null | Promise<CompletionResult | null> => {
    const member = afterDot(context);
    const answer = server?.(context) ?? null;
    if (member) return answer === null ? null : Promise.resolve(answer).catch(() => null);
    if (answer === null) return fallback(context);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<"slow">((resolve) => {
      timer = setTimeout(() => {
        resolve("slow");
      }, serverWaitMs);
    });
    const raced = Promise.race([Promise.resolve(answer), slow]).finally(() => {
      clearTimeout(timer);
    });
    return raced.then(
      (result) => (result === "slow" || result === null ? fallback(context) : result),
      () => fallback(context),
    );
  };
}

/** A completion source over `words()`, read at each request so it follows the notebook. */
function wordsCompletion(words: () => readonly Word[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w$]*/u);
    if (word === null || (word.from === word.to && !context.explicit)) return null;
    const typed = context.state.sliceDoc(word.from, word.to);
    return {
      from: word.from,
      options: words()
        .filter((each) => each.label !== typed)
        .map(({ label, detail }) => ({ label, detail, type: "text" })),
      validFor: /^[\w$]*$/u,
    };
  };
}
