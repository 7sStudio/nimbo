// Property test: whatever text surrounds them, redaction leaves no secret of 8 or more characters in
// its output, in any of the forms outputs carry it (as is, JSON-escaped, util.inspect-escaped), nor a Stripe token.
import { inspect } from "node:util";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createRedactor, minSecretLength } from "./redact.js";

const runs = { numRuns: 50 };

const secret = fc.string({ unit: "binary", minLength: minSecretLength, maxLength: 24 });
const filler = fc.string({ unit: "binary", maxLength: 12 });
const prefix = fc.constantFrom("sk_live_", "sk_test_", "rk_", "whsec_");

/** The forms a secret takes in outputs. */
const forms = (value: string): readonly string[] => [
  value,
  JSON.stringify(value).slice(1, -1),
  inspect(value).slice(1, -1),
];

describe("createRedactor as a property", () => {
  it("leaves no secret in any of its forms, however the text around it reads", () => {
    const pieces = fc.array(fc.tuple(filler, fc.nat(9), fc.nat(2)), { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(fc.array(secret, { minLength: 1, maxLength: 3 }), pieces, (secrets, parts) => {
        const text = parts
          .map(
            ([around, which, form]) =>
              around + (forms(secrets[which % secrets.length] ?? "")[form] ?? ""),
          )
          .join("");
        const redacted = createRedactor(secrets)(text);
        for (const value of secrets) {
          for (const shown of forms(value)) expect(redacted).not.toContain(shown);
        }
      }),
      runs,
    );
  });

  it("leaves no Stripe token, built at run time from its prefix", () => {
    const tail = fc.stringMatching(/^[A-Za-z0-9_]{0,24}$/);
    fc.assert(
      fc.property(filler, prefix, tail, filler, (before, start, rest, after) => {
        const redacted = createRedactor([])(`${before} ${start}${rest} ${after}`);
        expect(redacted).not.toMatch(/\b(?:sk_live_|sk_test_|rk_|whsec_)/);
      }),
      runs,
    );
  });
});
