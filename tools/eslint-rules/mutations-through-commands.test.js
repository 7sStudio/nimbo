// Rule 2 of 08 §8: mutating registry commands from store/ and commands/ only; elsewhere in ui, a dispatched id.
import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import { mutationsThroughCommands } from "./mutations-through-commands.js";

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: "module" } });
const ui = (dir) => `/repo/packages/ui/src/${dir}/File.ts`;

describe("jsnb/mutations-through-commands", () => {
  it("allows store/ and commands/, other packages, reads and dispatched ids", () => {
    tester.run("mutations-through-commands", mutationsThroughCommands, {
      valid: [
        {
          filename: ui("store"),
          code: 'import { cellDelete } from "@jsnb/core"; client.cell.delete({});',
        },
        { filename: ui("commands"), code: "client.notebook.run({});" },
        { filename: "/repo/packages/cli/src/run.ts", code: "client.cell.run({});" },
        {
          filename: ui("cells"),
          code: 'import { cellGet, isJsnbError } from "@jsnb/core"; client.cell.get({});',
        },
        {
          filename: ui("cells"),
          code: 'dispatch("cell.delete"); store.remove(order, id); run(); a[b].c();',
        },
        {
          filename: ui("cells"),
          code: 'import { cellDelete } from "./local.js"; import core from "@jsnb/core";',
        },
      ],
      invalid: [
        {
          filename: ui("cells"),
          code: 'import { cellDelete, kernelRestart as restart } from "@jsnb/core";',
          errors: [{ messageId: "direct" }, { messageId: "direct" }],
        },
        {
          filename: ui("app"),
          code: "session.client.notebook.save({}); client.kernel.restart({});",
          errors: [{ messageId: "direct" }, { messageId: "direct" }],
        },
      ],
    });
  });
});
