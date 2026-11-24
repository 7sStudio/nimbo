// The forms a JSON flag takes, read from its JSON Schema for the help (03-api §8): alternatives joined by `|`,
// literals, records with their keys (`key?` when optional), lists, the id patterns as <cell> and <execution>, enums,
// null.
type Schema = Readonly<Record<string, unknown>>;

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const literal = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

/** The id patterns of 03-api §2 by what they name. */
const idNames: readonly (readonly [string, string])[] = [
  ["c_", "<cell>"],
  ["x_", "<execution>"],
];

function stringForms(schema: Schema): string {
  const pattern = typeof schema.pattern === "string" ? schema.pattern : "";
  return idNames.find(([prefix]) => pattern.includes(prefix))?.[1] ?? "<text>";
}

function objectForms(schema: Schema): string {
  const properties = isSchema(schema.properties) ? Object.entries(schema.properties) : [];
  if (properties.length === 0)
    return isSchema(schema.additionalProperties)
      ? `{<key>: ${formsOf(schema.additionalProperties)}}`
      : "{}";
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const keys = properties.map(
    ([key, value]) => `${key}${required.has(key) ? "" : "?"}: ${formsOf(value)}`,
  );
  return `{${keys.join(", ")}}`;
}

const byType: Readonly<Record<string, (schema: Schema) => string>> = {
  null: () => "null",
  boolean: () => "true|false",
  integer: () => "<n>",
  number: () => "<n>",
  string: stringForms,
  array: (schema) => `[${formsOf(schema.items)}, …]`,
  object: objectForms,
};

/** The forms `schema` accepts, as the help prints them; `<any JSON>` for a schema that takes anything. */
export function formsOf(schema: unknown): string {
  if (!isSchema(schema)) return "<any JSON>";
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) return alternatives.map(formsOf).join(" | ");
  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(literal).join("|");
  if (Array.isArray(schema.type))
    return schema.type.map((type: unknown) => formsOf({ type })).join("|");
  const shape = typeof schema.type === "string" ? byType[schema.type] : undefined;
  return shape === undefined ? "<any JSON>" : shape(schema);
}
