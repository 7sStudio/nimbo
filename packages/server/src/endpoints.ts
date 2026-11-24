// What the daemon's page endpoints serve (02-architecture §7), from the workspace and the options: the settings'
// JSON Schema, retained full values, the built UI, the UI feedback, the notebooks' routes and the page's modules at /npm/.
import { settingsJsonSchema } from "@jsnb/core";

import type { Log } from "./events/log.js";
import type { FeedbackStore } from "./files/feedback/feedbackStore.js";
import { createNpmModules } from "./files/npm/npmModules.js";
import { uiFile } from "./files/ui/uiFiles.js";
import type { JsnbDir } from "./files/workspaceDir.js";
import type { PageEndpoints } from "./http/pages.js";
import type { Workspace } from "./notebook/workspace/workspace.js";
import { serveRoute } from "./notebook/routes/serveRoute.js";

export type EndpointOptions = {
  /** The built UI, when there is one. */
  readonly uiDir: string | undefined;
  readonly routeTimeoutMs: number;
  readonly bundleTimeoutMs: number;
  readonly log: Log;
  /** The feedback notes, shared with the feedback commands. */
  readonly feedback: FeedbackStore;
};

type NpmModules = PageEndpoints["npm"];

/** A bare 404 carries no reason worth a log line. */
const logFailures =
  (npm: NpmModules, log: Log): NpmModules =>
  async (rest, signal) => {
    const answer = await npm(rest, signal);
    if (!answer.ok && answer.error !== undefined)
      log.warn(
        { module: rest, status: answer.status },
        `a page module failed: ${answer.error.message}`,
      );
    return answer;
  };

/** The endpoints' providers over `workspace`. */
export const pageEndpoints = (
  workspace: Workspace,
  jsnb: JsnbDir,
  options: EndpointOptions,
): PageEndpoints => ({
  settingsSchema: settingsJsonSchema,
  npm: logFailures(
    createNpmModules(
      { root: jsnb.root, cacheDir: jsnb.npmCache },
      { timeoutMs: options.bundleTimeoutMs, log: options.log },
    ),
    options.log,
  ),
  fullValue: workspace.notebooks.fullValue,
  ui: (rest) => uiFile(options.uiDir, rest),
  feedback: options.feedback,
  routes: async (call, signal) =>
    serveRoute(await workspace.notebooks.sessions(), call, {
      signal,
      timeoutMs: options.routeTimeoutMs,
    }),
});
