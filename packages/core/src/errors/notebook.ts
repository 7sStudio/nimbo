// The notebook's own call failures: a file command (notebook.delete, notebook.rename) on a notebook that
// is open (1012); an ApiError of the catalogue in api.ts.
import { ApiError } from "./api.js";

type Cause = { readonly cause?: unknown };

const notebookOpenMessage = (path: string): string =>
  `${path} is open. Close it with notebook.close first, then delete or rename it.`;

/** notebook.delete or notebook.rename of a notebook a session holds: its ref is its identity while open. */
export class NotebookOpen extends ApiError {
  declare readonly data: { readonly path: string };
  constructor(data: { readonly path: string }, options: Cause = {}) {
    super(1012, {
      name: "NotebookOpen",
      message: notebookOpenMessage(data.path),
      data,
      ...options,
    });
  }
}
