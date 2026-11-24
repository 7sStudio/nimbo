// Rule 1 of 08-code-standards §8: components under app/, cells/, panel/, overlays/, primitives/ never import @jsnb/client
// or the store's transport modules (store/client, store/transport, store/socket); only store/ and commands/ may.
import { isUnder } from "./paths.js";

const componentDirs = ["app", "cells", "panel", "overlays", "primitives"].map(
  (dir) => `packages/ui/src/${dir}`,
);
const clientPackage = /^@jsnb\/client(\/|$)/;
const storeTransport = /(^|\/)store\/(client|transport|socket)(\.[cm]?[jt]s)?$/;

const isForbidden = (source) => clientPackage.test(source) || storeTransport.test(source);

export const noClientInComponents = {
  meta: {
    type: "problem",
    docs: {
      description:
        "components never import @jsnb/client or the store's transport; they dispatch commands (08 §8 rule 1)",
    },
    schema: [],
    messages: {
      forbidden:
        "'{{source}}' is the client transport; components dispatch commands or call store actions instead (08-code-standards §8 rule 1).",
    },
  },
  create(context) {
    if (!isUnder(context.filename, componentDirs)) return {};
    const check = (node, source) => {
      if (typeof source === "string" && isForbidden(source)) {
        context.report({ node, messageId: "forbidden", data: { source } });
      }
    };
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
    };
  },
};
