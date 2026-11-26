// The Settings panel's fields, generated from settings.schema: one field per key,
// grouped by the key's prefix in the schema's order, its control read from the JSON Schema (an enum is a select, a
// boolean a switch, an integer a number field, a string a text field, null when it may be and is left empty). A
// `planned` key is left out until it ships. Nothing here knows a key by name.
import type { SettingsKey } from "@jsnb/core";
import { isSettingsKey } from "@jsnb/core";

export type Control =
  | { readonly kind: "select"; readonly options: readonly string[] }
  | { readonly kind: "switch" }
  | { readonly kind: "number"; readonly min: number }
  | { readonly kind: "text"; readonly nullable: boolean };

export type Field = {
  readonly key: SettingsKey;
  readonly title: string;
  readonly description: string;
  readonly control: Control;
  /** The schema's default: what a tab shows while its file does not set the key. */
  readonly fallback: unknown;
};

export type Group = { readonly name: string; readonly fields: readonly Field[] };

type Property = Readonly<Record<string, unknown>>;

const types = (property: Property): readonly unknown[] => {
  const type = property.type;
  return Array.isArray(type) ? type : [type];
};

/** The control a property's schema asks for. */
export function controlOf(property: Property): Control {
  const options = property.enum;
  if (Array.isArray(options))
    return { kind: "select", options: options.filter((each) => typeof each === "string") };
  const kinds = types(property);
  if (kinds.includes("boolean")) return { kind: "switch" };
  if (kinds.includes("integer") || kinds.includes("number")) {
    const exclusive = property.exclusiveMinimum;
    const minimum = property.minimum;
    const min =
      typeof minimum === "number" ? minimum : typeof exclusive === "number" ? exclusive + 1 : 0;
    return { kind: "number", min };
  }
  return { kind: "text", nullable: kinds.includes("null") };
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Group names: the key's prefix, written as a heading ("ui" is the interface). */
const groupName = (prefix: string): string =>
  prefix === "ui" ? "Interface" : `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`;

/** Whether a key gets a field: a record has no control here (Settings (JSON) edits it), and a planned key is not
 * offered until it ships. */
const offered = (property: Property): boolean =>
  !types(property).includes("object") && property.status !== "planned";

/** The schema's entry for `key` as a plain record, or undefined when it is not an object. */
function propertyOf(properties: object, key: string): Property | undefined {
  const raw: unknown = Reflect.get(properties, key);
  if (typeof raw !== "object" || raw === null) return undefined;
  return Object.fromEntries(
    Object.keys(raw).map((name): [string, unknown] => [name, Reflect.get(raw, name)]),
  );
}

/** Every key of `schema` as a field, grouped by prefix in first-seen order. */
export function groupsOf(schema: Readonly<Record<string, unknown>>): readonly Group[] {
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) return [];
  const groups = new Map<string, Field[]>();
  for (const key of Object.keys(properties)) {
    const property = propertyOf(properties, key);
    // a key this page does not know (a newer daemon's) gets no field: there is nothing it could write
    if (!isSettingsKey(key) || property === undefined || !offered(property)) continue;
    const prefix = key.split(".")[0] ?? key;
    const fields = groups.get(prefix) ?? [];
    fields.push({
      key,
      title: text(property.title) || key,
      description: text(property.description),
      control: controlOf(property),
      fallback: property.default,
    });
    groups.set(prefix, fields);
  }
  return [...groups].map(([prefix, fields]) => ({ name: groupName(prefix), fields }));
}

/** The value a tab shows, as VS Code's User and Workspace tabs do: what its own file sets, else the default; the
 * other file's value is said beside it ("Modified in"), never shown in its place. */
export function shownValue(
  entry: { readonly user?: unknown; readonly workspace?: unknown } | undefined,
  scope: "user" | "workspace",
  fallback: unknown,
): { readonly value: unknown; readonly set: boolean } {
  // a value is never undefined in a file (JSON), so undefined is "not set", null included as a value
  if (entry?.[scope] !== undefined) return { value: entry[scope], set: true };
  return { value: fallback, set: false };
}

/** The other file that sets the key, for "Modified in: Workspace" in the User tab and "Modified in: User" in the
 * Workspace tab ("Also modified in" when this tab's file sets it too). */
export function modifiedElsewhere(
  entry: { readonly user?: unknown; readonly workspace?: unknown } | undefined,
  scope: "user" | "workspace",
): "user" | "workspace" | null {
  const other = scope === "user" ? "workspace" : "user";
  return entry?.[other] !== undefined ? other : null;
}

/** What a typed number or text becomes: the value to write, or an error to show (and nothing written). */
export function parsed(control: Control, typed: string): { value: unknown } | { error: string } {
  if (control.kind === "number") {
    const value = Number(typed.trim());
    if (typed.trim() === "" || !Number.isInteger(value)) return { error: "A whole number." };
    if (value < control.min) return { error: `At least ${String(control.min)}.` };
    return { value };
  }
  if (control.kind === "text" && control.nullable && typed.trim() === "") return { value: null };
  return { value: typed };
}

/** Letters and digits only, lower case: `editor.font-size`, `editor.fontSize` and "Editor Font Size" meet. */
const compact = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** A line pasted from a settings file, `"editor.fontSize": 12`, searches for its key alone, as VS Code's does. */
const keyOfLine = (query: string): string | undefined => /^\s*"([^"]+)"\s*:/u.exec(query)?.[1];

/** The groups with only the fields every word of `query` finds in their title, description, key or group; a word also
 * matches with its separators and case set aside (`editor.font-size` finds `editor.fontSize`). */
export function matching(groups: readonly Group[], query: string): readonly Group[] {
  const words = (keyOfLine(query) ?? query)
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
  if (words.length === 0) return groups;
  return groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => {
        const text = [group.name, field.title, field.description, field.key]
          .join(" ")
          .toLowerCase();
        const keyText = compact(field.key);
        const titleText = compact(`${group.name} ${field.title}`);
        return words.every((word) => {
          if (text.includes(word)) return true;
          const bare = compact(word);
          return bare !== "" && (keyText.includes(bare) || titleText.includes(bare));
        });
      }),
    }))
    .filter((group) => group.fields.length > 0);
}

/** A setting's title as VS Code shows it beside its group, in Title Case and without the group's own word in front:
 * "Editor tab size" in Editor is "Tab Size", "Auto save delay" in Files is "Auto Save Delay". */
export function itemTitle(group: string, title: string): string {
  const words = title.split(" ");
  const rest =
    words[0]?.toLowerCase() === group.toLowerCase() && words.length > 1 ? words.slice(1) : words;
  return rest.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}
