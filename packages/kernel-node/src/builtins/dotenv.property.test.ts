// Property test: a .env written the way secrets.set writes it (each value double-
// quoted with ", \ and newlines escaped), between comments and blank lines, LF or CRLF, parses back to the same values.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseDotenv } from "./dotenv.js";

const runs = { numRuns: 50 };

/** A value as secrets.set writes it. */
const quoted = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;

const name = fc.stringMatching(/^[A-Z][A-Z0-9_]{0,15}$/);
const value = fc.string({ unit: "binary", maxLength: 40 });
const noise = fc.constantFrom("", "# a comment", "   ", '# KEY="not a value"');

describe("parseDotenv as a property", () => {
  it("reads back every value written double-quoted and escaped", () => {
    fc.assert(
      fc.property(
        fc.dictionary(name, value, { maxKeys: 6 }),
        fc.array(noise, { maxLength: 4 }),
        fc.boolean(),
        (values, comments, crlf) => {
          const lines = Object.entries(values).map(([key, text]) => `${key}=${quoted(text)}`);
          const text = [...comments, ...lines].join(crlf ? "\r\n" : "\n");
          expect(parseDotenv(text)).toEqual(values);
        },
      ),
      runs,
    );
  });
});
