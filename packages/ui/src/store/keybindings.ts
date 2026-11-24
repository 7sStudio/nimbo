// The keybindings store (03-api §4.11): the two keybindings files' rules (keybindings.rules), kept current
// by keybindings.changed, so a binding saved anywhere (the Keyboard Shortcuts editor, its JSON view, the CLI, an
// agent, a hand edit) arrives at once; app/useKeybindings.ts hands them to the live registry (keyboard/keymap.ts).
// Writes go through keybindings.set, keybindings.reset and the JSON view's file commands.
import type { SocketClient } from "@jsnb/client";
import type { KeybindingFiles } from "@jsnb/core";
import { keybindingsFile, keybindingsRules, keybindingsWriteFile } from "@jsnb/core";
import { defineStore } from "pinia";
import { shallowRef } from "vue";

import type { Attempt } from "./attempt.js";
import { attempter, usePageReport } from "./attempt.js";
import type { Scope } from "./settings.js";
import { refusalWords } from "./settings.js";
import { useSessionStore } from "./socket.js";

/** What a set or a reset is about. */
export type KeyTarget = {
  readonly command: string;
  readonly args?: Readonly<Record<string, unknown>> | undefined;
  readonly when: string;
};

const targetOf = (target: KeyTarget) => ({
  command: target.command,
  ...(target.args === undefined ? {} : { args: { ...target.args } }),
  when: target.when,
});

/** keybindings.set, keybindings.reset and the JSON view's file commands. */
function writes(client: () => SocketClient, attempt: Attempt) {
  return {
    /** Gives `target` exactly `keys` (keybindings.json's words) in the file of `scope`. */
    set: (target: KeyTarget, keys: readonly string[], scope: Scope) =>
      attempt(() => client().keybindings.set({ ...targetOf(target), keys: [...keys], scope })),
    /** Removes what the file of `scope` (both files when undefined) says about `target`. */
    reset: (target: KeyTarget, scope: Scope | undefined) =>
      attempt(() =>
        client().keybindings.reset({
          ...targetOf(target),
          ...(scope === undefined ? {} : { scope }),
        }),
      ),
    file: (scope: Scope) => attempt(() => client().call(keybindingsFile, { scope })),
    /** Replaces a file with `text`: the refusal's words, or null once written. */
    writeFile: async (scope: Scope, text: string): Promise<string | null> => {
      try {
        await client().call(keybindingsWriteFile, { scope, text });
        return null;
      } catch (error) {
        return refusalWords(error);
      }
    },
  };
}

export const useKeybindingsStore = defineStore("keybindings", () => {
  const session = useSessionStore();
  const attempt = attempter(usePageReport());
  const client = () => session.session().client;
  const files = shallowRef<KeybindingFiles>({ user: [], workspace: [] });
  const load = async () => {
    files.value = (await attempt(() => client().call(keybindingsRules, {}))) ?? files.value;
  };
  return {
    files,
    /** Loads the rules and follows keybindings.changed; loads them again after a gap in the workspace stream. */
    start: async () => {
      session.session().onWorkspaceEvent((event) => {
        if (event.type === "keybindings.changed") files.value = event.data;
      });
      session.session().onWorkspaceGap(() => void load());
      await load();
    },
    ...writes(client, attempt),
  };
});
