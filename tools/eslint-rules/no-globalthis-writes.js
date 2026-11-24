// The no-globalthis-writes rule of 08-code-standards §8: in kernel-node/src/scope/ and runtime-web/src/realm/, no assignment
// to a property of globalThis, window or self; the scope object is the only writable namespace (04-kernel §3.3).
import { isUnder } from "./paths.js";

const scopeDirs = ["packages/kernel-node/src/scope", "packages/runtime-web/src/realm"];
const globalNames = new Set(["globalThis", "window", "self"]);

/** The identifier at the root of a member chain (`globalThis` in `globalThis.a.b`), or null. */
const rootOf = (node) => {
  let current = node;
  while (current.type === "MemberExpression") current = current.object;
  return current.type === "Identifier" ? current.name : null;
};

const isGlobalMember = (target) =>
  target.type === "MemberExpression" && globalNames.has(rootOf(target) ?? "");

export const noGlobalthisWrites = {
  meta: {
    type: "problem",
    docs: {
      description:
        "no assignment to globalThis, window or self properties in the realm scope code (08 §8)",
    },
    schema: [],
    messages: {
      write:
        "Writing to {{name}} is not allowed here; the scope object is the only writable namespace (04-kernel §3.3).",
    },
  },
  create(context) {
    if (!isUnder(context.filename, scopeDirs)) return {};
    const report = (node, target) =>
      context.report({ node, messageId: "write", data: { name: rootOf(target) ?? "" } });
    return {
      AssignmentExpression: (node) => {
        if (isGlobalMember(node.left)) report(node, node.left);
      },
      UpdateExpression: (node) => {
        if (isGlobalMember(node.argument)) report(node, node.argument);
      },
      UnaryExpression: (node) => {
        if (node.operator === "delete" && isGlobalMember(node.argument))
          report(node, node.argument);
      },
    };
  },
};
