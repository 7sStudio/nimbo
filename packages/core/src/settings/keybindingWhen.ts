// When clauses: the context keys of the page and the notebook's mode, each maybe negated, joined by &&.

/** The context keys a when clause may name: the page, and the notebook's mode. `commandMode`: no editor
 * or text field has the focus; `editMode`: a cell's editor has it; `markdownEditing`: that cell is a markdown cell. */
export const whenContextKeys = [
  "home",
  "notebook",
  "commandMode",
  "editMode",
  "markdownEditing",
] as const;
export type WhenContextKey = (typeof whenContextKeys)[number];

type Term = { readonly key: WhenContextKey; readonly not: boolean };
type When = { readonly text: string; readonly terms: readonly Term[] };

const isContextKey = (word: string): word is WhenContextKey =>
  whenContextKeys.some((key) => key === word);

/** A when clause: context keys, each maybe negated with `!`, joined by `&&`; none (or "") holds everywhere. A problem
 * names what the clause gets wrong. */
export function parseWhen(
  text: string | undefined,
): { readonly when: When } | { readonly problem: string } {
  const source = (text ?? "").trim();
  if (source === "") return { when: { text: "", terms: [] } };
  const terms: Term[] = [];
  for (const part of source.split("&&")) {
    const word = part.trim();
    const not = word.startsWith("!");
    const key = (not ? word.slice(1) : word).trim();
    if (!isContextKey(key))
      return {
        problem:
          key === ""
            ? `"${source}" is not a when clause`
            : `Unknown context key "${key}" (use ${whenContextKeys.join(", ")}, joined by &&)`,
      };
    terms.push({ key, not });
  }
  return {
    when: { terms, text: terms.map((each) => `${each.not ? "!" : ""}${each.key}`).join(" && ") },
  };
}

const parsedWhens = new Map<string, When>();
/** A normalised when clause's terms (the entries hold valid clauses only). */
function whenOf(text: string): When {
  const known = parsedWhens.get(text);
  if (known !== undefined) return known;
  const read = parseWhen(text);
  const when = "when" in read ? read.when : { text, terms: [] };
  parsedWhens.set(text, when);
  return when;
}

/** How specific a normalised clause is: its number of terms. */
export const whenTerms = (when: string): number => whenOf(when).terms.length;

/** True when `when` holds where `context` (the context keys that are true) is. */
export function whenHolds(when: string, context: ReadonlySet<string>): boolean {
  return whenOf(when).terms.every((term) => context.has(term.key) !== term.not);
}

/** Every place a binding can act: a page with no mode (a text field or a menu has the focus), command mode, edit mode
 * and markdown editing. */
export const whenContexts: readonly ReadonlySet<string>[] = ["home", "notebook"].flatMap((page) =>
  [[], ["commandMode"], ["editMode"], ["editMode", "markdownEditing"]].map(
    (modes) => new Set([page, ...modes]),
  ),
);
