// What the command handlers act on (validate, act on the session, emit): the workspace and its
// notebooks, the event stream, the feedback notes and the daemon's own stop.
import type { EventOf } from "@jsnb/core";

import type { EventBus } from "../events/bus.js";
import type { TutorialProgress } from "../notebook/workspace/examples.js";
import type { FeedbackNotes } from "../notebook/workspace/feedbackNotes.js";
import type { FolderService } from "../notebook/workspace/folders.js";
import type { Workspace } from "../notebook/workspace/workspace.js";

type SqlStatus = {
  readonly installed: boolean;
  readonly version: string;
  readonly source: "dependency" | "installed" | "missing";
  readonly folder: string;
};
type SqlProgress = EventOf<"sql.progress">["data"];

export type Services = {
  readonly workspace: Workspace;
  readonly bus: EventBus;
  /** Open folder: the listing, the recent folders and workspace.open. */
  readonly folders: FolderService;
  /** How far the workspace went in the tutorial's lessons (examples.list). */
  readonly tutorial: TutorialProgress;
  /** The page's feedback notes in `.jsnb/feedback/`, over the store /feedback/ serves too. */
  readonly feedback: FeedbackNotes;
  /** The DuckDB binding of SQL output queries (sql.status, sql.install), from files/duckdb. */
  readonly sql: {
    readonly status: () => SqlStatus;
    readonly install: (onProgress: (progress: SqlProgress) => void) => Promise<SqlStatus>;
  };
  /** Stops the daemon after the current answer (workspace.stop). */
  readonly requestStop: () => void;
};
