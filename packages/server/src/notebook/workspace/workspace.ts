// The workspace as the daemon serves it (02-architecture §7): its facts for workspace.info, its settings, secrets and
// packages, the open notebooks and the JSON query engines they share; closed once, at the daemon's stop.
import { defaultRequestTimeoutMs } from "../../kernel/requests.js";
import { join } from "node:path";

import type { IdGenerator, NotebookList } from "@jsnb/core";
import { apiVersion, keybindingsFileName, settingsFileName } from "@jsnb/core";
import type { KernelEntry } from "@jsnb/kernel-node";

import type { EventBus } from "../../events/bus.js";
import { workspaceStream } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import { watchNotebookList } from "./listWatch.js";
import { notebookList } from "../../files/notebooks/list.js";
import type { JsnbDir } from "../../files/workspaceDir.js";
import type { GitService } from "../git/service.js";
import { createGitService } from "../git/service.js";
import type { Language, LanguageOptions } from "../language/language.js";
import { createLanguage } from "../language/language.js";
import type { Adapter } from "../../kernel/debug/adapter.js";
import { createAdapter } from "../../kernel/debug/adapter.js";
import type { JsonEngines } from "../query/engines.js";
import { createJsonEngines } from "../query/engines.js";
import { serialClear } from "./cacheClear.js";
import { kernelNodeVersion } from "./nodeVersion.js";
import type { Notebooks } from "./notebooks.js";
import { createNotebooks } from "./notebooks.js";
import type { PackagesService } from "./packages.js";
import { createPackages } from "./packages.js";
import type { SecretsService } from "./secrets.js";
import { createSecrets } from "./secrets.js";
import type { KeybindingsService } from "./keybindings.js";
import { openKeybindings } from "./keybindings.js";
import type { SettingsService } from "./settings.js";
import { openSettings } from "./settings.js";

/** What workspace.info reports about the daemon itself. */
type DaemonFacts = {
  readonly root: string;
  readonly serverVersion: string;
  readonly pid: number;
  readonly startedAt: string;
};

type WorkspaceInfo = DaemonFacts & {
  readonly apiVersion: number;
  readonly nodeVersion: string;
  readonly notebooks: NotebookList;
};

export type Workspace = {
  readonly facts: DaemonFacts;
  readonly settings: SettingsService;
  /** The user's and the workspace's keybindings.json over the default keys (03-api §4.11). */
  readonly keybindings: KeybindingsService;
  readonly secrets: SecretsService;
  readonly packages: PackagesService;
  readonly notebooks: Notebooks;
  /** The JSON query engines the notebooks share. */
  readonly engines: JsonEngines;
  /** The TypeScript language service of the notebooks' cells. */
  readonly language: Language;
  /** The Source Control commands over the repository the folder is in. */
  readonly git: GitService;
  readonly info: () => Promise<WorkspaceInfo>;
  /** cache.clear: empties `.jsnb/cache/npm/` while the daemon runs (07 §7); one clear at a time. */
  readonly clearCache: () => Promise<{ readonly entries: number; readonly bytes: number }>;
  readonly close: () => Promise<void>;
};

export type WorkspaceOptions = {
  readonly facts: DaemonFacts;
  readonly jsnb: JsnbDir;
  /** `$XDG_CONFIG_HOME/nimbo` or `~/.config/nimbo`: where the user settings file lives. */
  readonly userConfigDir: string;
  readonly bus: EventBus;
  readonly log: Log;
  /** Hears every write of `.env` (the daemon's redactor reads it again). */
  readonly onEnvWrite: () => void;
  readonly ids: IdGenerator;
  readonly now: () => Date;
  /** The daemon's port, known once it listens (kernels need it for routeUrl). */
  readonly port: () => number;
  readonly kernelEntry: KernelEntry | undefined;
  /** The daemon's redaction (its token and the .env secrets), for what a page reports. */
  readonly redact: (text: string) => string;
  /** How long one packages.add may run; default 10 minutes. */
  readonly installTimeoutMs?: number;
  /** How long a session waits for its kernel's or its page's answer; default 10 s. */
  readonly requestTimeoutMs?: number;
  /** How often the open notebooks' files are checked for a move (moves.ts); the daemon's rootCheckMs. */
  readonly moveCheckMs?: number;
  /** How often the notebook list is read again for files created, deleted or renamed outside nimbo; default 5 s. */
  readonly listCheckMs?: number;
  /** The language worker's options (the tests hear each worker started). */
  readonly languageWorker?: LanguageOptions["worker"];
};

/** workspace.info: the daemon's facts, the kernels' Node and every notebook of the workspace, open or not. */
async function infoOf(
  facts: DaemonFacts,
  notebooks: Notebooks,
  nodeVersion: () => Promise<string>,
): Promise<WorkspaceInfo> {
  const [list, node] = await Promise.all([
    notebookList(facts.root, notebooks.openRefs()),
    nodeVersion(),
  ]);
  return { ...facts, apiVersion, nodeVersion: node, notebooks: list };
}

/**
 * The notebooks.changed announcer: each call reads the list as it is then and emits it on the workspace stream,
 * one after another, so the last event carries the latest list; a list that cannot be read is logged, never thrown.
 */
function announcer(root: string, opened: () => readonly string[], bus: EventBus, log: Log) {
  let last: Promise<void> = Promise.resolve();
  return (): Promise<void> => {
    last = last.then(async () => {
      try {
        bus.emit(workspaceStream, "notebooks.changed", {
          notebooks: await notebookList(root, opened()),
        });
      } catch (error) {
        log.warn({ err: error }, "the notebook list could not be read for notebooks.changed");
      }
    });
    return last;
  };
}

/** How long a session waits for its kernel's or its page's answer: the option, else 10 s. */
const requestTimeoutOf = (options: WorkspaceOptions): number =>
  options.requestTimeoutMs ?? defaultRequestTimeoutMs;

/** One callback that runs `first`, then the language service's, set once it exists. */
const both = (first: () => void, later: { readonly language: () => void }) => (): void => {
  first();
  later.language();
};

/** Closes the workspace's services: js-debug (the kernels' debug sessions end with it), the language worker, the
 * installs, the notebooks, the engines; the notebook list's watch first. */
async function closeAll(
  parts: Pick<
    Workspace,
    "language" | "packages" | "notebooks" | "engines" | "settings" | "keybindings" | "git"
  >,
  debugAdapter: Adapter,
  stopListWatch: () => void,
): Promise<void> {
  stopListWatch();
  debugAdapter.stop();
  parts.git.close();
  await parts.language.close();
  await parts.packages.close();
  await parts.notebooks.closeAll();
  await parts.engines.dispose();
  parts.settings.close();
  parts.keybindings.close();
}

/** The language service over the workspace's notebooks, its `.env` names and its settings. */
function languageOf(
  options: WorkspaceOptions,
  parts: { settings: SettingsService; secrets: SecretsService; notebooks: Notebooks },
): Language {
  const { settings, secrets, notebooks } = parts;
  return createLanguage({
    ...{ root: options.facts.root, bus: options.bus, log: options.log, session: notebooks.require },
    envNames: async () => ({
      server: await secrets.list(),
      client: Object.keys(await secrets.publicEnv()),
    }),
    setting: (key) => settings.current()[key],
    ...(options.languageWorker ? { worker: options.languageWorker } : {}),
  });
}

/** The settings and the keybindings, each from the user's file and the workspace's (07-file-format §6). */
async function openPreferences(
  options: WorkspaceOptions,
): Promise<Pick<Workspace, "settings" | "keybindings">> {
  const { userConfigDir, jsnb, bus, log } = options;
  const user = join(userConfigDir, settingsFileName);
  const settings = await openSettings({ user, workspace: jsnb.settingsFile }, bus, log);
  const files = {
    user: join(userConfigDir, keybindingsFileName),
    workspace: join(jsnb.dir, keybindingsFileName),
  };
  return { settings, keybindings: await openKeybindings(files, bus, log) };
}

/** packages.add and packages.remove through the workspace's package manager. */
const packagesOf = (options: WorkspaceOptions, settings: SettingsService) =>
  createPackages(options.facts.root, {
    bus: options.bus,
    log: options.log,
    settings: settings.current,
    redact: options.redact,
    timeoutMs: options.installTimeoutMs ?? 600_000,
  });

/** The watch on the notebook list for files created, deleted or renamed outside nimbo (listWatch.ts). */
const listWatchOf = (
  options: WorkspaceOptions,
  notebooks: Notebooks,
  announce: () => Promise<void>,
): (() => void) =>
  watchNotebookList({
    ...{ root: options.facts.root, openRefs: () => notebooks.openRefs(), announce },
    ...{ log: options.log, debounceMs: 300, everyMs: options.listCheckMs ?? 5000 },
  });

/** Opens the workspace's services (the settings files are read and watched from here on). */
export async function openWorkspace(options: WorkspaceOptions): Promise<Workspace> {
  const { facts, jsnb, bus, log } = options;
  const { settings, keybindings } = await openPreferences(options);
  const engines = createJsonEngines(settings.current);
  const envWrites = { language: (): void => undefined };
  const onEnvWrite = both(options.onEnvWrite, envWrites);
  const secrets = createSecrets(join(facts.root, ".env"), onEnvWrite);
  const realm = { redact: options.redact, publicEnv: secrets.publicEnv };
  const debugAdapter = createAdapter({ log });
  const listChanged = announcer(facts.root, () => notebooks.openRefs(), bus, log); // read once created
  const notebooks = createNotebooks({
    debugAdapter,
    ...{ root: facts.root, logsDir: jsnb.logs, bus, log, ids: options.ids, now: options.now },
    ...{ settings: settings.current, port: options.port, kernelEntry: options.kernelEntry },
    ...{ engines, sqlDirectory: jsnb.sqlCache, realm, requestTimeoutMs: requestTimeoutOf(options) },
    listChanged,
    ...(options.moveCheckMs === undefined ? {} : { moveCheckMs: options.moveCheckMs }),
  });
  const stopListWatch = listWatchOf(options, notebooks, listChanged);
  const nodeVersion = kernelNodeVersion(settings);
  const language = languageOf(options, { settings, secrets, notebooks });
  envWrites.language = language.envChanged;
  const workspace: Workspace = {
    facts,
    settings,
    keybindings,
    secrets,
    packages: packagesOf(options, settings),
    notebooks,
    engines,
    language,
    git: createGitService({ root: facts.root, bus, notebooks, log }),
    info: () => infoOf(facts, notebooks, nodeVersion),
    clearCache: serialClear(jsnb.npmCache, log),
    close: () => closeAll(workspace, debugAdapter, stopListWatch),
  };
  return workspace;
}
