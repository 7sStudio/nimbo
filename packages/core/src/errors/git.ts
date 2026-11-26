// The Source Control commands' own failure: git refused or failed, or there is no
// repository to act on. Its message is git's own decisive line, which says what to do (a hook's output, "nothing to
// commit", an identity to set), with credentials in URLs redacted; `reason` names the cases a caller acts on.
import { ApiError } from "./api.js";

type Cause = { readonly cause?: unknown };

/** Why git refused, when a caller can act on it (offer Stash & Switch, Publish, Force Delete, a confirm). */
export type GitReason =
  | "busy"
  | "cancelled"
  | "confirm"
  | "auth"
  | "network"
  | "noUpstream"
  | "noRemote"
  | "rejected"
  | "diverged"
  | "localChanges"
  | "unmerged"
  | "unsaved"
  | "detached"
  | "exists";

type GitFailure = {
  /** The git subcommand that failed (`commit`, `push`), or `repository` when the workspace is in none. */
  readonly command: string;
  /** Git's exit code, or null when it never ran (no git binary, a timeout, a refusal of ours). */
  readonly code: number | null;
  readonly message: string;
  readonly reason?: GitReason;
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
