// How Source Control's page commands call the daemon: a refusal git explains with a reason the page can act on
// (confirm, localChanges, noUpstream, unmerged) opens the dialog that asks, as VS Code does; a cancel says nothing; any
// other failure is a toast.
import type { GitReason } from "@jsnb/core";
import { GitFailed } from "@jsnb/core";

import { usePageReport } from "../store/attempt.js";
import { useGitStore } from "../store/git.js";
import type { Overlay } from "../store/overlay.js";
import type { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { uiCommand } from "./command.js";

type OnReason = Partial<Record<GitReason, (error: GitFailed) => void>>;

export type GitCall = <T>(work: () => Promise<T>, on?: OnReason) => Promise<T | undefined>;

export function useGitCall(): GitCall {
  const report = usePageReport();
  return async (work, on = {}) => {
    try {
      return await work();
    } catch (error) {
      const reason = error instanceof GitFailed ? error.data.reason : undefined;
      if (reason === "cancelled") return undefined;
      const handle = reason === undefined ? undefined : on[reason];
      if (handle !== undefined && error instanceof GitFailed) handle(error);
      else report(error);
      return undefined;
    }
  };
}

/** Opens the confirm of an action that can lose work; its button sends `command` with `args`. */
export function ask(
  ui: ReturnType<typeof useUiStore>,
  words: Omit<Extract<Overlay, { kind: "gitAsk" }>, "kind">,
): void {
  ui.overlay = { kind: "gitAsk", ...words };
}

/** A Source Control command that writes: a view-only tab refuses it (the dispatcher's `writes`). */
export const gitWrite = (
  id: string,
  title: string,
  run: Command["run"],
  when?: Command["when"],
): Command => ({ ...uiCommand(id, title, run, when), writes: true });

export const inRepo = (): boolean => useGitStore().repo !== null;

export const yes = (args?: Args): boolean => args?.confirm === true;
