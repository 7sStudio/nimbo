// The only file that imports @swaggerexpert/jsonpath or sees its AST (11-query §2): compile a query and classify its
// cost, select normalized paths in the worker or, with a time slice, in the calling thread.
import type { EvaluationRealmInterface } from "@swaggerexpert/jsonpath";
import { evaluate, JSONEvaluationRealm, parse } from "@swaggerexpert/jsonpath";

import type { NormalizedPath, SelectResult } from "../engine.ts";
import { maxQueryLength } from "../engine.ts";
import type { Result } from "../errors.ts";
import { fail, messageOf, ok } from "../errors.ts";

const expected = (expectations: readonly string[]): string =>
  expectations.length === 0
    ? ""
    : `; expected ${expectations
        .slice(0, 8)
        .map((token) => JSON.stringify(token))
        .join(", ")}`;

const syntaxMessage = (
  query: string,
  position: number,
  expectations: readonly string[],
): string => {
  const found = position < query.length ? JSON.stringify(query.charAt(position)) : "end of query";
  return `JSONPath syntax error at position ${String(position)}: unexpected ${found}${expected(expectations)}. Fix the query at the marked position.`;
};

/**
 * Tracing makes the parser some fifty times slower (about 50 ms per 1 000 characters), so it runs only on a failed
 * query of at most 500 characters (at most about 30 ms); a longer one's error gives the position alone.
 */
const tracedLength = 500;

/** What the parser expected at its furthest offset, for a short failed query. */
const expectationsOf = (query: string): readonly string[] => {
  if (query.length > tracedLength) return [];
  const { trace } = parse(query, { trace: true });
  return trace ? [...trace.inferExpectations()] : [];
};

type Operator = Parameters<EvaluationRealmInterface["compare"]>[1];

/** What compiling a query tells the engine: whether its cost is linear in the value (11-query §2). */
export type CompiledJsonPath = { readonly linear: boolean };

// The cost classifier reads the parser's AST as plain data: the library's published AST types do not match what it
// builds ("JsonPathQuery", "SingularQuerySegment", "op"), and anything it does not recognise counts as not linear.
type AstNode = Readonly<Record<string, unknown>>;

const isAstNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nodesOf = (value: unknown): readonly AstNode[] =>
  Array.isArray(value) ? value.filter(isAstNode) : [];

const typeOf = (value: unknown): unknown => (isAstNode(value) ? value.type : undefined);

const plainSelectors: ReadonlySet<unknown> = new Set([
  "NameSelector",
  "IndexSelector",
  "WildcardSelector",
  "SliceSelector",
]);
const singularSelectors: ReadonlySet<unknown> = new Set(["NameSelector", "IndexSelector"]);

/** `@.a.b[0]` used as a test: child segments that each select one name or one index. */
const isSingularSegment = (segment: AstNode): boolean => {
  if (segment.type !== "ChildSegment") return false;
  const selector = segment.selector;
  if (typeOf(selector) === "NameSelector") return true;
  const selected =
    isAstNode(selector) && selector.type === "BracketedSelection"
      ? nodesOf(selector.selectors)
      : [];
  return selected.length === 1 && singularSelectors.has(typeOf(selected[0]));
};

const isRelativeSingularTest = (test: unknown): boolean =>
  isAstNode(test) &&
  test.type === "FilterQuery" &&
  isAstNode(test.query) &&
  test.query.type === "RelQuery" &&
  nodesOf(test.query.segments).every(isSingularSegment);

/** A literal against a literal or a relative singular query; two queries could compare whole subtrees. */
const isLiteralComparison = (left: unknown, right: unknown): boolean => {
  const operand = (node: unknown): boolean =>
    typeOf(node) === "Literal" || typeOf(node) === "RelSingularQuery";
  return (
    (typeOf(left) === "Literal" && operand(right)) || (typeOf(right) === "Literal" && operand(left))
  );
};

/** Comparisons, logic and relative singular tests only: no function, no absolute or non-singular query. */
const isLinearLogic = (expression: unknown): boolean => {
  if (!isAstNode(expression)) return false;
  switch (expression.type) {
    case "LogicalOrExpr":
    case "LogicalAndExpr":
      return isLinearLogic(expression.left) && isLinearLogic(expression.right);
    case "LogicalNotExpr":
      return isLinearLogic(expression.expression);
    case "ComparisonExpr":
      return isLiteralComparison(expression.left, expression.right);
    case "TestExpr":
      return isRelativeSingularTest(expression.expression);
    default:
      return false;
  }
};

const isLinearSelector = (selector: unknown): boolean => {
  if (!isAstNode(selector)) return false;
  if (selector.type === "BracketedSelection") {
    // Several selectors in one bracket multiply the nodes each step yields: $[0,0][0,0]… doubles per step.
    const selectors = nodesOf(selector.selectors);
    return selectors.length === 1 && isLinearSelector(selectors[0]);
  }
  if (selector.type === "FilterSelector") return isLinearLogic(selector.expression);
  return plainSelectors.has(selector.type);
};

/** At most one descendant segment, one selector per bracket, and linear filters: the cost grows with the value. */
const isLinear = (tree: unknown): boolean => {
  if (!isAstNode(tree) || tree.type !== "JsonPathQuery") return false;
  const segments = nodesOf(tree.segments);
  const descendants = segments.filter((segment) => segment.type === "DescendantSegment");
  return descendants.length <= 1 && segments.every((segment) => isLinearSelector(segment.selector));
};

/**
 * Checks a query against RFC 9535's grammar and well-typedness rules, and classifies its cost; the error carries the
 * position when known.
 */
export const compileJsonPath = (query: string): Result<CompiledJsonPath> => {
  if (query.length > maxQueryLength) {
    const message = `The JSONPath query is ${String(query.length)} characters long, over the limit of ${String(maxQueryLength)}. Shorten it, for example by asking for fewer ids at a time.`;
    return fail("syntax", message, maxQueryLength);
  }
  try {
    const { result, tree } = parse(query);
    if (result.success) return ok({ linear: isLinear(tree) });
    return fail(
      "syntax",
      syntaxMessage(query, result.maxMatched, expectationsOf(query)),
      result.maxMatched,
    );
  } catch (cause) {
    return fail("syntax", `${messageOf(cause)}. Fix the query and run it again.`);
  }
};

/** Thrown from inside the evaluation when the calling thread's time slice has run out. */
const sliceExpired = new Error("The calling thread's time slice ran out.");

/** How many realm operations pass between two readings of the clock. */
const checkEvery = 64;

/**
 * The library's JSON realm behind a plain object that counts each operation the evaluator asks of it. The evaluator
 * calls the realm at every traversal step (each node it visits is tested or read through it), so the clock is read
 * often enough to give up in time.
 */
const slicedRealm = (deadline: number): EvaluationRealmInterface => {
  const json = new JSONEvaluationRealm();
  let operations = 0;
  const counted =
    <A extends unknown[], R>(operation: (...args: A) => R) =>
    (...args: A): R => {
      operations += 1;
      if (operations % checkEvery === 0 && performance.now() > deadline) throw sliceExpired;
      return operation(...args);
    };
  return {
    name: json.name,
    isObject: counted((value: unknown) => json.isObject(value)),
    isArray: counted((value: unknown) => json.isArray(value)),
    isString: counted((value: unknown) => json.isString(value)),
    isNumber: counted((value: unknown) => json.isNumber(value)),
    isBoolean: counted((value: unknown) => json.isBoolean(value)),
    isNull: counted((value: unknown) => json.isNull(value)),
    getString: counted((value: unknown) => json.getString(value)),
    getProperty: counted((value: unknown, key: string) => json.getProperty(value, key)),
    hasProperty: counted((value: unknown, key: string) => json.hasProperty(value, key)),
    getElement: counted((value: unknown, index: number) => json.getElement(value, index)),
    getKeys: counted((value: unknown) => json.getKeys(value)),
    getLength: counted((value: unknown) => json.getLength(value)),
    compare: counted((left: unknown, operator: Operator, right: unknown) =>
      json.compare(left, operator, right),
    ),
    entries: counted((value: unknown) => json.entries(value)),
  };
};

const isExpired = (cause: unknown): boolean =>
  cause === sliceExpired || (cause instanceof Error && cause.cause === sliceExpired);

const runtimeFailure = (cause: unknown): Result<never> =>
  fail(
    "runtime",
    `The JSONPath query failed on this value (${messageOf(cause)}). Query a plain JSON value, or narrow the query to the part that fails.`,
  );

/** Runs a compiled query over a value and returns the normalized paths of the selected nodes, in document order. */
export const selectPaths = (json: unknown, query: string): Result<SelectResult> => {
  const paths: NormalizedPath[] = [];
  try {
    evaluate(json, query, { trace: false, callback: (_value, path) => void paths.push(path) });
    return ok({ paths });
  } catch (cause) {
    return runtimeFailure(cause);
  }
};

/** selectPaths for the calling thread: `expired` once the run passes `deadline` (a performance.now() time). */
export const selectPathsBefore = (
  json: unknown,
  query: string,
  deadline: number,
): Result<SelectResult> | "expired" => {
  const paths: NormalizedPath[] = [];
  try {
    const realm = slicedRealm(deadline);
    // Each result's path is built (a loop over every character of every name on it) before the callback, outside the
    // realm, so the clock is read here as well.
    const collect = (_value: unknown, path: NormalizedPath): void => {
      paths.push(path);
      if (performance.now() > deadline) throw sliceExpired;
    };
    evaluate(json, query, { trace: false, realm, callback: collect });
    return ok({ paths });
  } catch (cause) {
    return isExpired(cause) ? "expired" : runtimeFailure(cause);
  }
};
