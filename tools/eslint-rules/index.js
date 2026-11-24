// The local ESLint plugin "jsnb": the registry rules of 08-code-standards §8, loaded by eslint.config.js.
import { mutationsThroughCommands } from "./mutations-through-commands.js";
import { noClientInComponents } from "./no-client-in-components.js";
import { noGlobalthisWrites } from "./no-globalthis-writes.js";

const plugin = {
  meta: { name: "eslint-plugin-jsnb", version: "0.0.0" },
  rules: {
    "no-client-in-components": noClientInComponents,
    "no-globalthis-writes": noGlobalthisWrites,
    "mutations-through-commands": mutationsThroughCommands,
  },
};

export default plugin;
