// The errors a .jsnb file can raise on load (07-file-format §2 and §4): version, duplicate ids, validation.
import { JsnbError } from "./jsnbError.js";

type Cause = { readonly cause?: unknown };

type Newer = {
  readonly path: string;
  readonly version: number;
  readonly supported: number;
  readonly appVersion: string;
};
const newerVersionMessage = ({ path, version, supported, appVersion }: Newer): string =>
  `${path} is version ${String(version)}; this nimbo (${appVersion}) reads up to version ${String(supported)}. Update nimbo.`;

export class NewerVersion extends JsnbError {
  declare readonly data: Newer;
  constructor(data: Newer, options: Cause = {}) {
    super({ name: "NewerVersion", message: newerVersionMessage(data), data, ...options });
  }
}

type Duplicate = { readonly id: string; readonly positions: readonly number[] };
const duplicateCellIdMessage = ({ id, positions }: Duplicate): string =>
  `Cell id ${id} appears ${String(positions.length)} times (${positions.map((p) => `cells[${String(p)}]`).join(", ")}). Give each cell a unique id.`;

export class DuplicateCellId extends JsnbError {
  declare readonly data: Duplicate;
  constructor(data: Duplicate, options: Cause = {}) {
    super({ name: "DuplicateCellId", message: duplicateCellIdMessage(data), data, ...options });
  }
}

export type NotebookIssue = { readonly path: string; readonly message: string };
type Invalid = { readonly path?: string; readonly issues: readonly NotebookIssue[] };
const invalidNotebookMessage = ({ path, issues }: Invalid): string => {
  const first = issues[0] ?? { path: "", message: "not a valid notebook" };
  const where = first.path === "" ? "" : `${first.path}: `;
  const file = path === undefined ? "" : `${path}: `;
  return `${file}${where}${first.message}`;
};

export class InvalidNotebook extends JsnbError {
  declare readonly data: Invalid;
  constructor(data: Invalid, options: Cause = {}) {
    super({ name: "InvalidNotebook", message: invalidNotebookMessage(data), data, ...options });
  }
}
