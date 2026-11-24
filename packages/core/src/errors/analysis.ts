// The analysis errors a cell can raise (04-kernel §3.2, §3.3): transform throws them, core defines them.
import { JsnbError } from "./jsnbError.js";

/** The 1-based line and column of the offending node's start. */
export type Position = { readonly line: number; readonly col: number };

export type InvalidSyntaxData = Position & {
  /** TypeScript's own message text for the first syntactic diagnostic. */
  readonly detail: string;
};

const invalidSyntaxMessage = ({ detail, line, col }: InvalidSyntaxData): string =>
  `${detail} (${String(line)}:${String(col)})`;

/** The cell does not parse: the first syntactic diagnostic, with TypeScript's text. */
export class InvalidSyntax extends JsnbError {
  declare readonly data: InvalidSyntaxData;
  constructor(data: InvalidSyntaxData, options: { readonly cause?: unknown } = {}) {
    super({ name: "SyntaxError", message: invalidSyntaxMessage(data), data, ...options });
  }
}

const defaultExportMessage = ({ line }: Position): string =>
  "`export default` is not supported: name your export (`export const result = …`) " +
  `so other cells and the bridge can refer to it (line ${String(line)}).`;

/** `export default …` or `export =`: the bridge needs a name (04-kernel §3.2). */
export class DefaultExport extends JsnbError {
  declare readonly data: Position;
  constructor(data: Position, options: { readonly cause?: unknown } = {}) {
    super({ name: "DefaultExport", message: defaultExportMessage(data), data, ...options });
  }
}

export type UnsupportedConstruct =
  "enum" | "namespace" | "export *" | "export from" | "import require" | "using";

export type UnsupportedSyntaxData = Position & { readonly construct: UnsupportedConstruct };

const unsupportedAdvice: Readonly<Record<UnsupportedConstruct, readonly [string, string]>> = {
  enum: ["Top-level enum", "use a const object or a union of literal types."],
  namespace: ["Top-level namespace", "use a plain object or a separate file."],
  "export *": ["`export *`", "import the names first, then export them."],
  "export from": ["`export … from`", "import the names first, then export them."],
  "import require": ['`import x = require("p")`', 'use `import x from "p"`.'],
  using: [
    "Top-level `using`",
    "call `[Symbol.dispose]()` yourself or register `dispose(() => …)`.",
  ],
};

const unsupportedSyntaxMessage = ({ construct, line }: UnsupportedSyntaxData): string => {
  const [what, advice] = unsupportedAdvice[construct];
  return `${what} is not supported in a cell (line ${String(line)}); ${advice}`;
};

/** A construct the transform rejects rather than lowers: the message names it and says what to do. */
export class UnsupportedSyntax extends JsnbError {
  declare readonly data: UnsupportedSyntaxData;
  constructor(data: UnsupportedSyntaxData, options: { readonly cause?: unknown } = {}) {
    super({ name: "UnsupportedSyntax", message: unsupportedSyntaxMessage(data), data, ...options });
  }
}

export type ReservedNameData = Position & { readonly name: string };

const reservedNameMessage = ({ name, line }: ReservedNameData): string =>
  `\`${name}\` is reserved by the notebook; rename it (line ${String(line)}).`;

/** A cell declares `__scope`, `__import`, `__export` or `$peek` (04-kernel §3.3). */
export class ReservedName extends JsnbError {
  declare readonly data: ReservedNameData;
  constructor(data: ReservedNameData, options: { readonly cause?: unknown } = {}) {
    super({ name: "ReservedName", message: reservedNameMessage(data), data, ...options });
  }
}
