// The hand-written shortcuts of 03-api §8, in its order: `nimbo mcp`, then the install's own upgrade, uninstall and
// doctor, as the table ends.
import { addShortcut } from "./add.js";
import { catShortcut } from "./cat.js";
import { checkShortcut } from "./check.js";
import { configShortcut } from "./config.js";
import { diffShortcut } from "./diff.js";
import { errorsShortcut } from "./errors.js";
import { exportShortcut } from "./export.js";
import { eventsShortcut } from "./events.js";
import { lsShortcut } from "./ls.js";
import { doctorShortcut } from "./doctor.js";
import { mcpShortcut } from "./mcp.js";
import { openShortcut } from "./open.js";
import { outputsShortcut } from "./outputs.js";
import { runShortcut } from "./run.js";
import { serveShortcut } from "./serve.js";
import type { Shortcut } from "./shortcut.js";
import { sqlShortcut } from "./sql.js";
import { statusShortcut } from "./status.js";
import { stopShortcut } from "./stop.js";
import { uninstallShortcut } from "./uninstall.js";
import { upgradeShortcut } from "./upgrade.js";

export const shortcuts: readonly Shortcut[] = [
  openShortcut,
  serveShortcut,
  stopShortcut,
  statusShortcut,
  lsShortcut,
  catShortcut,
  outputsShortcut,
  runShortcut,
  addShortcut,
  errorsShortcut,
  exportShortcut,
  checkShortcut,
  diffShortcut,
  eventsShortcut,
  configShortcut,
  mcpShortcut,
  upgradeShortcut,
  uninstallShortcut,
  doctorShortcut,
  sqlShortcut,
];

/** The shortcut `nimbo <name>` runs, or undefined. */
export const shortcutNamed = (name: string): Shortcut | undefined =>
  shortcuts.find((shortcut) => shortcut.name === name);
