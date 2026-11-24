import { describe, expect, it } from "vitest";

import { folderKeysOf, treeOf } from "./homeTree.js";

describe("treeOf", () => {
  it("nests notebooks under their folders, folders first, in natural order", () => {
    const tree = treeOf([
      "b.jsnb",
      "api/stripe/checkout.jsnb",
      "a10.jsnb",
      "a2.jsnb",
      "api/routes.jsnb",
    ]);
    const shape = (nodes: ReturnType<typeof treeOf>): unknown =>
      nodes.map((node) => (node.folder ? { [node.key]: shape(node.children ?? []) } : node.name));
    expect(shape(tree)).toEqual([
      { "api/": [{ "api/stripe/": ["checkout.jsnb"] }, "routes.jsnb"] },
      "a2.jsnb",
      "a10.jsnb",
      "b.jsnb",
    ]);
    expect(folderKeysOf("api/stripe/checkout.jsnb")).toEqual(["api/", "api/stripe/"]);
  });
});
