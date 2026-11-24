// The SQL text both backends send: quoted names and literals, and the statements that load, alias, copy and drop.
import type { ExportFormat } from "./engine.ts";

/** A double-quoted identifier, `"` doubled, so any table or alias name is safe in SQL. */
export const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** A single-quoted string literal, `'` doubled. */
export const quoteLiteral = (text: string): string => `'${text.replaceAll("'", "''")}'`;

/** The SQL without the semicolons (and blanks) that end it, so it can sit inside `COPY (…)`. */
export const withoutTrailingSemicolons = (sql: string): string => sql.replace(/[\s;]+$/u, "");

/** What exportAll puts before the user's SQL; positions in DuckDB's errors are shifted back by its length. */
export const copyPrefix = "COPY (\n";

const id = quoteIdentifier;

/** `*`, with the columns written as text because they hold a UBIGINT above INT64_MAX cast back to UBIGINT. */
const replacing = (unsigned: readonly string[]): string =>
  unsigned.length === 0
    ? "*"
    : `* REPLACE (${unsigned.map((name) => `CAST(${id(name)} AS UBIGINT) AS ${id(name)}`).join(", ")})`;

/** The statements the engines run; every name is quoted, every path is a literal. */
export const statements = {
  /**
   * sample_size = -1 scans every row, so a type change after row 20 480 does not fail the load. DuckDB detects one
   * timestamp format per file, so two columns written differently fail the whole load; 'iso' pins the format
   * JavaScript writes (`toISOString()`, `2026-10-11T08:30:00.125Z`) and leaves any other text a VARCHAR.
   */
  fromJson: (table: string, path: string, unsigned: readonly string[] = []) =>
    `CREATE OR REPLACE TABLE ${id(table)} AS SELECT ${replacing(unsigned)} FROM read_json_auto(${quoteLiteral(path)}, sample_size = -1, dateformat = 'iso', timestampformat = 'iso')`,
  fromTable: (table: string, source: string) =>
    `CREATE OR REPLACE TABLE ${id(table)} AS SELECT * FROM ${id(source)}`,
  alias: (alias: string, table: string) =>
    `CREATE OR REPLACE VIEW ${id(alias)} AS SELECT * FROM ${id(table)}`,
  begin: "BEGIN TRANSACTION",
  commit: "COMMIT",
  rollback: "ROLLBACK",
  dropView: (name: string) => `DROP VIEW IF EXISTS ${id(name)}`,
  dropTable: (name: string) => `DROP TABLE IF EXISTS ${id(name)}`,
  sample: (table: string) => `SELECT * FROM ${id(table)} LIMIT 0`,
  count: (table: string) => `SELECT count(*) AS n FROM ${id(table)}`,
  /** The closing parenthesis sits on its own line, so a trailing `-- comment` in the user's SQL stays harmless. */
  copy: (sql: string, path: string, format: ExportFormat) =>
    `${copyPrefix}${withoutTrailingSemicolons(sql)}\n) TO ${quoteLiteral(path)} (${format === "csv" ? "FORMAT csv, HEADER" : "FORMAT json"})`,
} as const;

/** The MIME type of an export. */
export const exportType = (format: ExportFormat): string =>
  format === "csv" ? "text/csv" : "application/x-ndjson";

/** The file extension of an export. */
export const exportExtension = (format: ExportFormat): string =>
  format === "csv" ? "csv" : "json";
