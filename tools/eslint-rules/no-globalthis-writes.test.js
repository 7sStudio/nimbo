// Tests the no-globalthis-writes rule of 08 §8 with ESLint's RuleTester.
import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import { noGlobalthisWrites } from "./no-globalthis-writes.js";

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: "module" } });
const scope = "/repo/packages/kernel-node/src/scope/scope.ts";
const realm = "/repo/packages/runtime-web/src/realm/execute.ts";
const elsewhere = "/repo/packages/kernel-node/src/outputs/stream.ts";

describe("jsnb/no-globalthis-writes", () => {
  it("allows reads, scope writes and writes outside the realm directories", () => {
    tester.run("no-globalthis-writes", noGlobalthisWrites, {
      valid: [
        { filename: scope, code: "const x = globalThis.fetch;" },
        { filename: scope, code: "scope.answer = 42;" },
        { filename: realm, code: "self.postMessage(1);" },
        { filename: elsewhere, code: "globalThis.marker = 1;" },
      ],
      invalid: [],
    });
  });

  it("rejects assignments, updates and deletes on globalThis, window and self", () => {
    tester.run("no-globalthis-writes", noGlobalthisWrites, {
      valid: [],
      invalid: [
        { filename: scope, code: "globalThis.marker = 1;", errors: [{ messageId: "write" }] },
        { filename: scope, code: "globalThis.a.b = 1;", errors: [{ messageId: "write" }] },
        { filename: realm, code: "window.counter++;", errors: [{ messageId: "write" }] },
        { filename: realm, code: "delete self.cache;", errors: [{ messageId: "write" }] },
      ],
    });
  });
});
