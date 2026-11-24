// The daemon's DuckDB binding as the Settings page shows it (03-api §4.16): its status read once the row mounts,
// sql.install on a click, the step under way from the sql.progress events of any install (the page's or an agent's).
import type { EventEnvelope } from "@jsnb/core";
import { defineStore } from "pinia";
import { ref } from "vue";

import { errorToast } from "./report.js";
import { useSessionStore } from "./socket.js";
import { useUiStore } from "./ui.js";

export type SqlEngineState = "unknown" | "missing" | "installing" | "done" | "present";

export const useSqlEngineStore = defineStore("sqlEngine", () => {
  const session = useSessionStore();
  const ui = useUiStore();
  const state = ref<SqlEngineState>("unknown");
  /** `2/3` while an install runs. */
  const step = ref("");
  let following = false;

  const onEvent = (event: EventEnvelope): void => {
    if (event.type !== "sql.progress" || event.data.step === "ready") return;
    state.value = "installing";
    step.value = `${String(event.data.index + 1)}/${String(event.data.count)}`;
  };

  return {
    state,
    step,
    /** Reads sql.status; a daemon without the command has nothing to offer. */
    load: async () => {
      if (!following) {
        following = true;
        session.session().onWorkspaceEvent(onEvent);
      }
      try {
        const status = await session.session().client.sql.status({});
        if (state.value === "unknown") state.value = status.installed ? "present" : "missing";
      } catch {
        state.value = "present"; // an older daemon: no row
      }
    },
    install: async () => {
      state.value = "installing";
      step.value = "";
      try {
        await session.session().client.sql.install({});
        state.value = "done";
      } catch (error) {
        state.value = "missing";
        ui.toast(errorToast(error));
      }
    },
  };
});
