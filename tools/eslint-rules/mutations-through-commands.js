// jsnb/mutations-through-commands: in packages/ui, a registry command tagged mutating or destructive is called only from
// src/store/ and src/commands/; everything else dispatches a command id. Two call shapes reach a command: the typed
// client's method (`client.cell.delete(…)`) and the descriptor imported from @jsnb/core (`call(cellDelete, …)`).
import { mutatingCommands } from "./mutating-commands.js";
import { isUnder, posix } from "./paths.js";

const allowed = ["packages/ui/src/store", "packages/ui/src/commands"];
const mutating = new Set(mutatingCommands);
/** `cell.delete` → `cellDelete`, the descriptor's export name in core. */
const exportNames = new Map(
  mutatingCommands.map((name) => {
    const [domain, verb] = name.split(".");
    return [`${domain}${verb.charAt(0).toUpperCase()}${verb.slice(1)}`, name];
  }),
);

const propertyName = (node) =>
  node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : undefined;

export const mutationsThroughCommands = {
  meta: {
    type: "problem",
    docs: {
      description:
        "mutating and destructive registry commands are called only from store/ and commands/",
    },
    schema: [],
    messages: {
      direct:
        "'{{name}}' changes shared state: dispatch the command id instead, or call it from src/store or src/commands.",
    },
  },
  create(context) {
    const file = posix(context.filename);
    if (!file.includes("/packages/ui/src/") || isUnder(file, allowed)) return {};
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@jsnb/core") return;
        for (const specifier of node.specifiers) {
          const name =
            specifier.type === "ImportSpecifier"
              ? exportNames.get(specifier.imported.name)
              : undefined;
          if (name !== undefined)
            context.report({ node: specifier, messageId: "direct", data: { name } });
        }
      },
      CallExpression(node) {
        const verb = propertyName(node.callee);
        const domain = verb === undefined ? undefined : propertyName(node.callee.object);
        const name = `${domain}.${verb}`;
        if (domain !== undefined && mutating.has(name)) {
          context.report({ node, messageId: "direct", data: { name } });
        }
      },
    };
  },
};
