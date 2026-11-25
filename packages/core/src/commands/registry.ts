// The command registry of 03-api §3: every descriptor in the order of the tables, with the lookups the surfaces use.
import { bridgeCall, bridgeEvents } from "./bridge.js";
import {
  cellAdd,
  cellBindings,
  cellCompare,
  cellDelete,
  cellGet,
  cellMarkReviewed,
  cellMove,
  cellOutputQuery,
  cellOutputs,
  cellOutputValue,
  cellRevert,
  cellRun,
  cellSnapshot,
  cellUpdate,
} from "./cell.js";
import {
  debugEvaluate,
  debugPause,
  debugRemoveBreakpoint,
  debugResume,
  debugScope,
  debugSetBreakpoint,
  debugStack,
  debugStepInto,
  debugStepOut,
  debugStepOver,
  debugState,
  debugVariables,
} from "./debug.js";
import type { AnyCommand } from "./define.js";
import { eventsSubscribe } from "./events.js";
import { examplesCopy, examplesList } from "./examples.js";
import { feedbackList, feedbackUpdate } from "./feedback.js";
import { gitCommit, gitDiff, gitDiscard, gitInit, gitStage, gitStatus, gitUnstage } from "./git.js";
import {
  gitBranchCreate,
  gitBranchDelete,
  gitBranchRename,
  gitBranches,
  gitSwitch,
} from "./gitBranch.js";
import { gitLog, gitShow } from "./gitHistory.js";
import {
  gitAbort,
  gitCancel,
  gitContinue,
  gitFetch,
  gitPublish,
  gitPull,
  gitPush,
  gitSync,
} from "./gitRemote.js";
import { gitStash, gitStashApply, gitStashDrop, gitStashList, gitStashPop } from "./gitStash.js";
import { cacheClear } from "./cache.js";
import { sqlInstall, sqlStatus } from "./sql.js";
import {
  kernelInterrupt,
  kernelLog,
  kernelRestart,
  kernelRoutes,
  kernelScope,
  kernelStatus,
} from "./kernel.js";
import {
  notebookClearOutputs,
  notebookClose,
  notebookCompareDisk,
  notebookCreate,
  notebookDelete,
  notebookErrors,
  notebookExport,
  notebookGet,
  notebookGraph,
  notebookOpen,
  notebookReload,
  notebookRename,
  notebookRun,
  notebookSave,
  notebookSummary,
} from "./notebook.js";
import { languageLsp, languageRename, notebookBridge, notebookDiagnostics } from "./language.js";
import { packagesAdd, packagesCancel, packagesList, packagesRemove } from "./packages.js";
import { realmAttach, realmDetach, realmReport, realmRestart, realmStatus } from "./realm.js";
import { secretsList, secretsSet } from "./secrets.js";
import {
  settingsFile,
  settingsGet,
  settingsSchemaCommand,
  settingsSet,
  settingsWriteFile,
} from "./settings.js";
import {
  keybindingsFile,
  keybindingsList,
  keybindingsReset,
  keybindingsRules,
  keybindingsSet,
  keybindingsWriteFile,
} from "./keybindings.js";
import {
  workspaceInfo,
  workspaceListFolders,
  workspaceOpen,
  workspaceRecentFolders,
  workspaceStop,
} from "./workspace.js";

/** Every command, in the order of 03-api §4.1 to §4.11 with bridge.call last. */
export const commands: readonly AnyCommand[] = [
  workspaceInfo,
  workspaceStop,
  workspaceListFolders,
  workspaceRecentFolders,
  workspaceOpen,
  notebookCreate,
  notebookOpen,
  notebookGet,
  notebookSave,
  notebookReload,
  notebookCompareDisk,
  notebookClose,
  notebookDelete,
  notebookRename,
  notebookSummary,
  notebookRun,
  notebookClearOutputs,
  notebookErrors,
  notebookGraph,
  notebookExport,
  notebookDiagnostics,
  notebookBridge,
  bridgeEvents,
  cellAdd,
  cellGet,
  cellUpdate,
  cellRevert,
  cellMarkReviewed,
  cellMove,
  cellDelete,
  cellRun,
  cellOutputs,
  cellCompare,
  cellOutputValue,
  cellBindings,
  cellOutputQuery,
  cellSnapshot,
  kernelStatus,
  kernelInterrupt,
  kernelRestart,
  kernelScope,
  kernelLog,
  kernelRoutes,
  realmStatus,
  realmRestart,
  realmAttach,
  realmDetach,
  realmReport,
  packagesList,
  packagesAdd,
  packagesRemove,
  packagesCancel,
  secretsList,
  secretsSet,
  eventsSubscribe,
  debugState,
  debugSetBreakpoint,
  debugRemoveBreakpoint,
  debugPause,
  debugResume,
  debugStepOver,
  debugStepInto,
  debugStepOut,
  debugStack,
  debugScope,
  debugVariables,
  debugEvaluate,
  settingsGet,
  settingsSet,
  settingsSchemaCommand,
  settingsFile,
  settingsWriteFile,
  keybindingsList,
  keybindingsSet,
  keybindingsReset,
  keybindingsRules,
  keybindingsFile,
  keybindingsWriteFile,
  examplesList,
  examplesCopy,
  feedbackList,
  feedbackUpdate,
  gitStatus,
  gitDiff,
  gitStage,
  gitUnstage,
  gitDiscard,
  gitCommit,
  gitFetch,
  gitPull,
  gitPush,
  gitPublish,
  gitSync,
  gitCancel,
  gitAbort,
  gitContinue,
  gitBranches,
  gitBranchCreate,
  gitSwitch,
  gitBranchRename,
  gitBranchDelete,
  gitStash,
  gitStashList,
  gitStashApply,
  gitStashPop,
  gitStashDrop,
  gitLog,
  gitShow,
  gitInit,
  cacheClear,
  sqlStatus,
  sqlInstall,
  languageLsp,
  languageRename,
  bridgeCall,
];

export const commandNames: readonly string[] = commands.map((command) => command.name);

/** The descriptor of a name, or undefined. */
export function commandByName(name: string): AnyCommand | undefined {
  return commands.find((command) => command.name === name);
}

/** The commands the CLI and MCP surfaces expose: everything not tagged internal. */
export function publicCommands(): readonly AnyCommand[] {
  return commands.filter((command) => !command.tags.internal);
}
