// The state one cell rewrite shares between its rules: the factory, the classifier, the recorder, the scope builders.
import ts from "typescript";

import type { BindingKind, Position } from "@jsnb/core";
import { ReservedName, isReservedName } from "@jsnb/core";

import type { Recorder } from "./analysis.js";
import { createRecorder } from "./analysis.js";
import type { Classification, Classify } from "./classify.js";
import { createClassify } from "./classify.js";
import { isAtTopLevel } from "./containers.js";
import type { Access } from "./references.js";

/** The transform's own calls on the scope, resolved before any cell name (04 §3.3). */
type Plumbing = "__export" | "__import" | "$peek";

export type Rewrite = {
  readonly file: ts.SourceFile;
  readonly context: ts.TransformationContext;
  readonly factory: ts.NodeFactory;
  readonly classify: Classify;
  readonly recorder: Recorder;
  /** `__scope.<name>`, mapped to `range`. */
  scoped(name: string, range: ts.Node): ts.PropertyAccessExpression;
  /** `__scope.<plumbing>(...args)`, mapped to `range`. */
  plumbing(name: Plumbing, args: readonly ts.Expression[], range: ts.Node): ts.CallExpression;
  /** The 1-based line and column where `node` starts. */
  at(node: ts.Node): Position;
};

/** The shared state of one cell's rewrite (a closure over the recorder, not a class: 08 §6). */
export function createRewrite(
  file: ts.SourceFile,
  context: ts.TransformationContext,
  checker: ts.TypeChecker,
): Rewrite {
  const { factory } = context;
  // The name is mapped to `range` too, not only the access: V8 places a ReferenceError (and a call's error) on the
  // name, and a position past the access's own mapping would be shifted by the `__scope.` prefix (8 columns).
  const scopeAccess = (name: string, range: ts.Node): ts.PropertyAccessExpression =>
    factory.createPropertyAccessExpression(
      factory.createIdentifier("__scope"),
      ts.setSourceMapRange(factory.createIdentifier(name), range),
    );
  return {
    file,
    context,
    factory,
    classify: createClassify(checker, file),
    recorder: createRecorder(),
    scoped: (name, range) => ts.setSourceMapRange(scopeAccess(name, range), range),
    plumbing: (name, args, range) =>
      ts.setSourceMapRange(
        factory.createCallExpression(scopeAccess(name, range), undefined, [...args]),
        range,
      ),
    at(node) {
      const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
      return { line: line + 1, col: character + 1 };
    },
  };
}

/** `__scope.__export("<exported>"[, "<local>"]);`, recorded in the analysis. */
export function exportStatement(
  rewrite: Rewrite,
  exported: string,
  local: string | undefined,
  range: ts.Node,
): ts.Statement {
  const { factory } = rewrite;
  rewrite.recorder.export(exported);
  const args = [factory.createStringLiteral(exported)];
  if (local !== undefined) args.push(factory.createStringLiteral(local));
  const call = rewrite.plumbing("__export", args, range);
  return ts.setSourceMapRange(factory.createExpressionStatement(call), range);
}

/** Records a top-level declaration of `id` with its kind, after refusing a reserved name. */
export function declare(rewrite: Rewrite, id: ts.Identifier, kind: BindingKind): void {
  if (isReservedName(id.text)) throw new ReservedName({ name: id.text, ...rewrite.at(id) });
  rewrite.recorder.define(id.text, kind);
}

/** `__scope.<id>` for a scoped reference (classified by the caller when it already has), noted in the analysis. */
export function reference(
  rewrite: Rewrite,
  id: ts.Identifier,
  access: Access,
  kind: Classification = rewrite.classify(id),
): ts.PropertyAccessExpression {
  if (access !== "write" && kind === "free") rewrite.recorder.use(id.text);
  if (access !== "read" && isAtTopLevel(id)) rewrite.recorder.define(id.text);
  return rewrite.scoped(id.text, id);
}
