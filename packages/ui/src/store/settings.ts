// The settings store: every value with its source (settings.get), the schema the Settings panel is
// generated from (settings.schema), kept current by settings.changed, and written by settings.set.
import type { SocketClient } from "@jsnb/client";
import type { EventEnvelope, SettingsKey } from "@jsnb/core";
import { settingsFile, settingsWriteFile } from "@jsnb/core";
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";

import type { Attempt } from "./attempt.js";
import { attempter, usePageReport } from "./attempt.js";
import { useSessionStore } from "./socket.js";

type Source = "default" | "user" | "workspace";
/** A key's effective value and source, and what the user and the workspace file each set it to (absent when unset). */
export type SettingValue = {
  readonly value: unknown;
  readonly source: Source;
  readonly user?: unknown;
  readonly workspace?: unknown;
};
export type Scope = "user" | "workspace";

/** What a refused file text gets wrong, each issue on its own ("Line 1, column 25: property name expected"), without
 * the error's "Invalid params: text:" prefix. */
export function refusalWords(error: unknown): string {
  const issues: unknown = Reflect.get(Object(Reflect.get(Object(error), "data")), "issues");
  const words = (issue: unknown): string => {
    const message = String(Reflect.get(Object(issue), "message"));
    const path: unknown = Reflect.get(Object(issue), "path");
    const key = Array.isArray(path) ? path.join(".") : "";
    return key === "" || key === "text" ? message : `${key}: ${message}`;
  };
  const messages = Array.isArray(issues) ? issues.map(words) : [];
  if (messages.length > 0) return messages.join("\n");
  return error instanceof Error ? error.message : String(error);
}

/** Settings (JSON): a file read as text, and replaced whole (the refusal's message when it does not parse or holds a
 * bad value, null once written). */
function fileActions(client: () => SocketClient, attempt: Attempt) {
  return {
    file: (scope: Scope) => attempt(() => client().call(settingsFile, { scope })),
    writeFile: async (scope: Scope, text: string): Promise<string | null> => {
      try {
        await client().call(settingsWriteFile, { scope, text });
        return null;
      } catch (error) {
        return refusalWords(error);
      }
    },
  };
}

export const useSettingsStore = defineStore("settings", () => {
  const session = useSessionStore();
  const attempt = attempter(usePageReport());
  const values = ref<Readonly<Record<string, SettingValue>>>({});
  const schema = shallowRef<Readonly<Record<string, unknown>>>({});
  const client = () => session.session().client;

  async function load(): Promise<void> {
    const [got, described] = await Promise.all([
      attempt(() => client().settings.get({})),
      attempt(() => client().settings.schema({})),
    ]);
    values.value = got?.values ?? values.value;
    schema.value = described?.schema ?? schema.value;
  }

  function onEvent(event: EventEnvelope): void {
    if (event.type !== "settings.changed") return;
    const { key, ...entry } = event.data;
    values.value = { ...values.value, [key]: entry };
  }

  return {
    values,
    schema,
    onEvent,
    /** Loads the values and the schema and follows settings.changed; loads them again after a gap in the workspace
     * stream, since a settings.changed missed while reconnecting would leave a stale value. */
    start: async () => {
      session.session().onWorkspaceEvent(onEvent);
      session.session().onWorkspaceGap(() => void load());
      await load();
    },
    /** The value of `key`, or undefined before start or for an unknown key. */
    valueOf: (key: SettingsKey): unknown => values.value[key]?.value,
    /** settings.set; the new value arrives as settings.changed. */
    set: (key: SettingsKey, value: unknown, scope: Scope = "workspace") =>
      attempt(() => client().settings.set({ key, value, scope })),
    /** Reset Setting: the key leaves the file of `scope`, the next scope or the default applies. */
    reset: (key: SettingsKey, scope: Scope) =>
      attempt(() => client().settings.set({ key, scope, reset: true })),
    ...fileActions(client, attempt),
  };
});
