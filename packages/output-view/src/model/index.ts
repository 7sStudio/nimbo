// Public API of @jsnb/output-view/model: the pure view model, which runs in Node and in the
// page (the CLI's pretty printing and HTML export use it as the Vue layer does). One line per file, public names only.

export type { OutputIssue, ViewInput } from "./output.js";
export { InvalidOutput, toOutput } from "./output.js";
export type { ShownView, SwitchView, ValueView, ViewKind, ViewOption } from "./detect.js";
export {
  chooseView,
  detect,
  detectValue,
  displayJson,
  isRenderedMime,
  viewsFor,
} from "./detect.js";
export type { Child, JsonObject, RowKey, WireKind } from "./wire.js";
export { childCount, children, isContainer, kindOf, refTarget, resolve } from "./wire.js";
export type { PathError, PathResult } from "./path.js";
export { formatKey, formatPath, normalizedPath, parseKey, parsePath, paths } from "./path.js";
export type { LeafOptions, Token, TokenKind } from "./leaf.js";
export { bytesHex, leafText, leafTokens } from "./leaf.js";
export type { PreviewOptions } from "./preview.js";
export { countLabel, preview, thousands, typeLabel } from "./preview.js";
export type { Expansion, Toggled } from "./expansion.js";
export {
  collapseAll,
  defaultExpandDepth,
  expandAll,
  expansion,
  revealPath,
  toggle,
  toggleDeep,
} from "./expansion.js";
export type { CloseRow, FlattenOptions, Focus, HiddenRow, NodeRow, Row } from "./tree.js";
export { flatten } from "./tree.js";
export { focusOf } from "./focus.js";
export type { Matcher, MatcherError, MatcherResult, TextRange } from "./matcher.js";
export { matcherOf } from "./matcher.js";
export type {
  SearchMatch,
  SearchOptions,
  SearchOutcome,
  SearchResult,
  SearchScope,
} from "./search.js";
export { matchesById, search, step } from "./search.js";
export type { Cell, Column, ColumnLayout, Grid, GridRow } from "./records.js";
export {
  arrangeColumns,
  arrangeGrid,
  cellOf,
  gridOf,
  hideColumn,
  moveColumn,
  sharedKeyRatio,
  showAllColumns,
} from "./records.js";
export { compareCells } from "./sort.js";
export type { Chip, ChipOp, ChipValue, ComparisonOp, TextOp } from "./chips.js";
export {
  chipKey,
  chipOps,
  chipText,
  columnChip,
  isTextOp,
  keyPath,
  literalOf,
  makeChip,
} from "./chips.js";
export type { FilterError, FilterResult } from "./filter.js";
export { formatFilter, parseFilter } from "./filter.js";
export type { Hint, HintContext, HintHook, HintSite, SourceTarget } from "./hints.js";
export {
  foldedChars,
  hintsFor,
  longStringChars,
  looksLikeJson,
  parseJsonText,
  unixWindowYears,
} from "./hints.js";
export { localDateTime, localIso, parseIsoText, relativeTime } from "./time.js";
export type { AnsiColor, AnsiStyle, Span } from "./ansi.js";
export { ansiRgb, parseAnsi, plainStyle, streamLines, stripAnsi } from "./ansi.js";
export type { Palette, PaletteToken, SurfaceToken, SyntaxToken, ThemeName } from "./palette.js";
export {
  contrast,
  luminance,
  minimumContrast,
  palettes,
  surfaceTokens,
  syntaxTokens,
  viewerBackground,
} from "./palette.js";
export type { Cause, ErrorModel, FrameGroup } from "./frames.js";
export { errorModel, frameLocation, groupFrames, packageOf } from "./frames.js";
export type { Summary } from "./summary.js";
export { formatBytes, jsonBytes, summarize, summaryParts, summaryText } from "./summary.js";
export { toPlain } from "./plain.js";
export { toLiteral } from "./literal.js";
export { toCSV } from "./csv.js";
export type { HtmlOptions } from "./html.js";
export { toHTML } from "./html.js";
export { notebookToHTML } from "./notebookHtml.js";
export type { NotebookHtmlCell, NotebookHtmlOptions } from "./notebookHtml.js";
export type { Exported, ExportFormat, ExportOptions, ExportOutcome } from "./export.js";
export { exportAs, exportFormats, exportSelection, toJSON, toNDJSON, toText } from "./export.js";
export type {
  ChipCompiler,
  EngineError,
  EngineResult,
  QueryEngines,
  RunOptions,
  SelectQueryEngine,
  SqlColumn,
  SqlQueryEngine,
  SqlRows,
  SqlSchema,
  TransformQueryEngine,
} from "./engines.js";
export {
  availableModes,
  defaultMode,
  firstUseNotes,
  firstUseSizes,
  queryModes,
} from "./engines.js";
export type {
  QueryAction,
  QueryFailure,
  QueryPin,
  QueryResult,
  QueryState,
  QueryStatus,
} from "./query.js";
export {
  fromPin,
  historySize,
  initialQuery,
  pinOf,
  queryText,
  reduceQuery,
  resultLabel,
} from "./query.js";
export type { QueryRun, RunOutcome } from "./run.js";
export { loadMode, registerRows, runQuery } from "./run.js";
export type { Example } from "./examples.js";
export { examples } from "./examples.js";
export type { ValueSlice } from "./slices.js";
export { loadLimit, moreAt, spliceSlice } from "./slices.js";
export type { ShownOutput } from "./streams.js";
export { mergeStreams } from "./streams.js";
