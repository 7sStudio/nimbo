// The Source Control commands' own failure of 03-api §7.4: git refused or failed, or there is no
// repository to act on. Its message is git's own first lines, which say what to do (a hook's output, "nothing to
// commit", an identity to set).
import { ApiError } from "./api.js";

type Cause = { readonly cause?: unknown };

type GitFailure = {
  /** The git subcommand that failed (`commit`, `add`), or `repository` when the workspace is in none. */
  readonly command: string;
  /** Git's exit code, or null when it never ran (no git binary, a timeout). */
  readonly code: number | null;
  readonly message: string;
};

export class GitFailed extends ApiError {
  declare readonly data: GitFailure;
  constructor(data: GitFailure, options: Cause = {}) {
    super(1013, {
      name: "GitFailed",
      message: `git ${data.command}: ${data.message}`,
      data,
      ...options,
    });
  }
}
