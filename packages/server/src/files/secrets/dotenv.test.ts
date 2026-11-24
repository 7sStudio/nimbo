// secrets.set's rewrite of .env (07-file-format §8): one key's line, every other line kept, values that round-trip.
import { parseDotenv } from "@jsnb/kernel-node";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { envLine, withEnvValue } from "./dotenv.js";

describe("withEnvValue", () => {
  it("rewrites only the key's last assignment and keeps comments, order and CRLF", () => {
    const text = "# keys\r\nA=1\r\nB='two'\r\nA=3\r\n\r\n# end\r\n";
    expect(withEnvValue(text, "A", "new")).toBe(
      "# keys\r\nA=1\r\nB='two'\r\nA=\"new\"\r\n\r\n# end\r\n",
    );
    expect(withEnvValue("export B=x\n", "B", "y")).toBe('B="y"\n');
  });

  it("appends a missing key, adding the newline the file lacked", () => {
    expect(withEnvValue("", "A", "1")).toBe('A="1"\n');
    expect(withEnvValue("A=1", "B", "2")).toBe('A=1\nB="2"\n');
    expect(withEnvValue("AB=1\n", "A", "2")).toBe('AB=1\nA="2"\n');
  });

  it("writes values that parseDotenv reads back exactly", () => {
    expect(envLine("K", 'a"b\\c\nd')).toBe('K="a\\"b\\\\c\\nd"');
    fc.assert(
      fc.property(
        fc.string(),
        (value) => parseDotenv(withEnvValue("X=0\n", "K", value)).K === value,
      ),
      { numRuns: 50 },
    );
  });
});
