// Public API of @jsnb/transform: the TypeScript transform (type stripping, declaration and import rewrite, exports, source maps)
// and the cell analysis, and what the debugger asks of it; the errors it throws and the CellAnalysis type are core's.
export { analyze } from "./analyze.js";
export type { TransformOptions, TransformResult } from "./transform.js";
export { transform } from "./transform.js";
export { conditionOf, evaluationOf, withDebuggerStatements } from "./debugging.js";
export { sourceOf } from "./source-map.js";
