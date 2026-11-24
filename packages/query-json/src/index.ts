// Public API of @jsnb/query-json: JSONPath, Filter chips and jq behind QueryEngine, and normalized path utilities.
export { chipsToJsonPath } from "./chips/compile.ts";
export { jsonPathToChips } from "./chips/parse.ts";
export type { Chip, ChipFilter, ChipValue } from "./chips/types.ts";
export type {
  CompiledSelect,
  CompiledTransform,
  EngineRegistry,
  HeldBound,
  HeldSelect,
  HeldTransform,
  HoldingSelectEngine,
  HoldingTransformEngine,
  NormalizedPath,
  QueryEngine,
  RunOptions,
  SelectEngine,
  SelectResult,
  TransformEngine,
  TransformResult,
  ValueHolder,
} from "./engine.ts";
export { createEngineRegistry } from "./engine.ts";
export type { QueryError, QueryErrorKind, Result } from "./errors.ts";
export type { JqEngineOptions } from "./jq/engine.ts";
export { createJqEngine } from "./jq/engine.ts";
export type { JsonPathEngineOptions } from "./jsonpath/engine.ts";
export { createJsonPathEngine } from "./jsonpath/engine.ts";
export type { PathSegment } from "./paths.ts";
export { formatPath, joinPath, parentPath, parsePath } from "./paths.ts";
