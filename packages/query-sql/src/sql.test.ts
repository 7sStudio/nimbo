// The SQL text the engines send: quoting, the trailing-semicolon strip and the statements.
import { describe, expect, it } from "vitest";

import {
  exportExtension,
  exportType,
  quoteIdentifier,
  quoteLiteral,
  statements,
  withoutTrailingSemicolons,
} from "./sql.ts";

describe("quoting", () => {
  it("doubles the quote character inside", () => {
    expect(quoteIdentifier('my "t"')).toBe('"my ""t"""');
    expect(quoteLiteral("it's.json")).toBe("'it''s.json'");
  });
});

describe("withoutTrailingSemicolons", () => {
  it("drops the semicolons and blanks that end the SQL, nothing inside", () => {
    expect(withoutTrailingSemicolons("SELECT ';' ; ;\n ")).toBe("SELECT ';'");
    expect(withoutTrailingSemicolons("SELECT 1")).toBe("SELECT 1");
  });
});

describe("statements", () => {
  it("quote every name and path", () => {
    expect(statements.fromJson("t", "__nimbo_load_1.json")).toBe(
      `CREATE OR REPLACE TABLE "t" AS SELECT * FROM read_json_auto('__nimbo_load_1.json', sample_size = -1, dateformat = 'iso', timestampformat = 'iso')`,
    );
    expect(statements.fromJson("t", "f.json", ["u", 'a"b'])).toBe(
      `CREATE OR REPLACE TABLE "t" AS SELECT * REPLACE (CAST("u" AS UBIGINT) AS "u", CAST("a""b" AS UBIGINT) AS "a""b") FROM read_json_auto('f.json', sample_size = -1, dateformat = 'iso', timestampformat = 'iso')`,
    );
    expect(statements.alias("events", "t")).toBe(
      'CREATE OR REPLACE VIEW "events" AS SELECT * FROM "t"',
    );
    expect(statements.dropView("e")).toBe('DROP VIEW IF EXISTS "e"');
    expect(statements.dropTable("t")).toBe('DROP TABLE IF EXISTS "t"');
    expect(statements.fromTable("t", "s")).toBe('CREATE OR REPLACE TABLE "t" AS SELECT * FROM "s"');
    expect(statements.sample("t")).toBe('SELECT * FROM "t" LIMIT 0');
    expect(statements.count("t")).toBe('SELECT count(*) AS n FROM "t"');
  });

  it("wrap the user's SQL in COPY with the closing parenthesis on its own line", () => {
    expect(statements.copy("SELECT 1 -- note;", "o.csv", "csv")).toBe(
      "COPY (\nSELECT 1 -- note\n) TO 'o.csv' (FORMAT csv, HEADER)",
    );
    expect(statements.copy("SELECT 1;", "o.json", "ndjson")).toBe(
      "COPY (\nSELECT 1\n) TO 'o.json' (FORMAT json)",
    );
  });
});

describe("export formats", () => {
  it("have a MIME type and an extension", () => {
    expect([exportType("csv"), exportExtension("csv")]).toEqual(["text/csv", "csv"]);
    expect([exportType("ndjson"), exportExtension("ndjson")]).toEqual([
      "application/x-ndjson",
      "json",
    ]);
  });
});
