// Error positions after characters outside ASCII, the same on both engines: exact after é, ü or an emoji; none
// (no underline) after wide CJK text, where DuckDB's own position no longer matches the SQL.

export type PositionCase = { readonly sql: string; readonly position: number | undefined };

const at = (sql: string): PositionCase => ({ sql, position: sql.indexOf("nope") });

export const widePositions: readonly PositionCase[] = [
  at("SELECT 'é' AS a, nope"),
  at("SELECT 1 AS a,\n  'ü' AS b, nope"),
  at("SELECT '😀' AS a, nope"),
  { sql: "SELECT '日本語テキスト' AS a, nope", position: undefined },
];
