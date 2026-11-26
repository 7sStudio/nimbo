// Public API of @jsnb/server: the daemon, started in-process for a workspace folder.
export { startServer } from "./server.js";
export type { RunningServer } from "./server.js";
export type { ServerOptions } from "./options.js";
export { defaultUserConfigDir } from "./options.js";
export { DaemonRunning, DaemonServingMovedFolder } from "./files/existingDaemon.js";
export { WorkspaceMissing, WorkspaceUnusable } from "./files/workspaceDir.js";
export { serverVersion } from "./files/version.js";
