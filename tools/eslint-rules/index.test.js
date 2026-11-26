// Checks the plugin exposes the three rules under the names eslint.config.js uses.
import { describe, expect, it } from "vitest";

import plugin from "./index.js";

describe("eslint-plugin-jsnb", () => {
  it("registers the three registry rules", () => {
    expect(Object.keys(plugin.rules).sort()).toEqual([
      "mutations-through-commands",
      "no-client-in-components",
      "no-globalthis-writes",
    ]);
  });
});
