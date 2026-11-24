// Tests rule 1 of 08 §8 with ESLint's RuleTester: components may not import the client transport.
import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import { noClientInComponents } from "./no-client-in-components.js";

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: "module" } });
const component = "/repo/packages/ui/src/cells/CellCard.ts";
const store = "/repo/packages/ui/src/store/notebook.ts";

describe("jsnb/no-client-in-components", () => {
  it("allows commands and stores in components, and the client in stores", () => {
    tester.run("no-client-in-components", noClientInComponents, {
      valid: [
        { filename: component, code: 'import { dispatch } from "@/commands/dispatch";' },
        { filename: component, code: 'import { useNotebookStore } from "@/store/notebook";' },
        { filename: component, code: 'export { x } from "./CellGutter";' },
        { filename: store, code: 'import { createClient } from "@jsnb/client";' },
        { filename: store, code: 'const mod = await import("@jsnb/client");' },
      ],
      invalid: [],
    });
  });

  it("rejects @jsnb/client and the store transport in components", () => {
    tester.run("no-client-in-components", noClientInComponents, {
      valid: [],
      invalid: [
        {
          filename: component,
          code: 'import { createClient } from "@jsnb/client";',
          errors: [{ messageId: "forbidden" }],
        },
        {
          filename: component,
          code: 'import { socket } from "../store/socket";',
          errors: [{ messageId: "forbidden" }],
        },
        {
          filename: component,
          code: 'export * from "@jsnb/client/events";',
          errors: [{ messageId: "forbidden" }],
        },
        {
          filename: component,
          code: 'const c = await import("@jsnb/client");',
          errors: [{ messageId: "forbidden" }],
        },
      ],
    });
  });
});
