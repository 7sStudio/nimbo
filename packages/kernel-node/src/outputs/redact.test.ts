// Tests the redactor: secrets of 8+ characters, longest first, escaped forms, token prefixes.
import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { createRedactor, minSecretLength } from "./redact.js";

/** A Stripe-like token built at run time, so no key-shaped literal sits in the repository. */
const token = (prefix: string): string => prefix + "Ab1".repeat(8);

describe("createRedactor secrets", () => {
  it("masks every secret of at least 8 characters and ignores shorter values", () => {
    const redact = createRedactor(["hunter22secret", "3000", "debug"]);
    expect(minSecretLength).toBe(8);
    expect(redact("pass=hunter22secret port=3000 level=debug")).toBe(
      "pass=*** port=3000 level=debug",
    );
  });

  it("masks the longest secret first when one contains another", () => {
    const redact = createRedactor(["abcdefgh", "abcdefghijkl"]);
    expect(redact("[abcdefghijkl] [abcdefgh]")).toBe("[***] [***]");
  });

  it("masks a secret as JSON and util.inspect escape it", () => {
    const secret = 'pa"ss\\wo\nrd';
    const redact = createRedactor([secret]);
    expect(redact(JSON.stringify({ secret }))).toBe('{"secret":"***"}');
    expect(redact(inspect({ secret }))).toBe("{ secret: '***' }");
  });

  it("leaves text without a secret unchanged", () => {
    expect(createRedactor([])("nothing to hide, sk-like but not a token")).toBe(
      "nothing to hide, sk-like but not a token",
    );
  });
});

describe("createRedactor tokens", () => {
  it("masks the sk_live_, sk_test_, rk_ and whsec_ prefixes with the rest of the token", () => {
    const redact = createRedactor([]);
    const text = ["sk_live_", "sk_test_", "rk_live_", "whsec_"].map(token).join(" ");
    expect(redact(text)).toBe("*** *** *** ***");
    expect(redact("network_id=work_item")).toBe("network_id=work_item");
  });

  it("masks a secret that starts like a token whole, not just its token part", () => {
    const secret = `${token("rk_")}-tail`;
    expect(createRedactor([secret])(`key=${secret};`)).toBe("key=***;");
  });

  it("repeats until nothing matches, so masks joined together never rebuild a secret", () => {
    const redact = createRedactor(["********"]);
    expect(redact("*".repeat(15))).not.toContain("********");
  });
});
