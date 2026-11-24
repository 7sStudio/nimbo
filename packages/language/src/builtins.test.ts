// The built-in names the virtual files import equal the realms' own layers:
// kernel-node's `layer` object and runtime-web's `builtinNames`, read from their sources with TypeScript's parser,
// since this package may not import either.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { expect, test } from "vitest";

import { clientBuiltinNames, serverBuiltinNames } from "./builtins.js";

const parse = (path: string): ts.SourceFile => {
  const file = fileURLToPath(new URL(path, import.meta.url));
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
};

/** Every node of `file` that `pick` maps to a value. */
function find<T>(file: ts.SourceFile, pick: (node: ts.Node) => T | undefined): T | undefined {
  let found: T | undefined;
  const visit = (node: ts.Node): void => {
    found ??= pick(node);
    if (found === undefined) ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Names the realms provide as their own globals, which the declarations leave to TypeScript's libraries. */
const globals = new Set([
  "console",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "requestAnimationFrame",
  "addEventListener",
  "removeEventListener",
  "window",
  "self",
  "globalThis",
  "document",
]);

test("the server declarations name kernel-node's built-ins layer", () => {
  const file = parse("../../kernel-node/src/builtinsLayer.ts");
  const names = find(file, (node) =>
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "layer" &&
    node.initializer &&
    ts.isObjectLiteralExpression(node.initializer)
      ? node.initializer.properties.flatMap((p) =>
          p.name && ts.isIdentifier(p.name) ? [p.name.text] : [],
        )
      : undefined,
  );
  expect(names?.filter((name) => !globals.has(name)).sort()).toEqual(
    [...serverBuiltinNames].sort(),
  );
});

test("the client declarations name runtime-web's built-ins layer", () => {
  const file = parse("../../runtime-web/src/realm/builtins.ts");
  const names = find(file, (node) =>
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "builtinNames" &&
    node.initializer
      ? collectStrings(node.initializer)
      : undefined,
  );
  expect(names?.filter((name) => !globals.has(name)).sort()).toEqual(
    [...clientBuiltinNames].sort(),
  );
});

function collectStrings(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isStringLiteral(child)) out.push(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return out;
}
