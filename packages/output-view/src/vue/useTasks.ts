// The viewer's long work (everything long takes a signal; nothing is swallowed): one task at a time, shown
// with its label and a Cancel that aborts its signal; a task cancelled, by the user or by the next one, is said so,
// and a failure is shown to the user instead of only the console.
import { ref, shallowRef } from "vue";

type Running = { readonly label: string; readonly controller: AbortController };

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function useTasks() {
  const running = shallowRef<Running>();
  const failure = ref<string>();
  /** What stopped without failing: a task the user cancelled, or one the next task replaced. */
  const notice = ref<string>();
  /** The task running now (read through a function: an await in between may have replaced it). */
  const current = (): Running | undefined => running.value;
  /** Runs `work` with a signal the Cancel button aborts; a failure (not a cancel) is shown as "`label` failed: …". */
  async function run(label: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const replaced = running.value;
    replaced?.controller.abort();
    notice.value = replaced && `Cancelled "${replaced.label}": "${label}" started.`;
    const controller = new AbortController();
    running.value = { label, controller };
    failure.value = undefined;
    try {
      await work(controller.signal);
    } catch (cause) {
      // Converted, not swallowed: the user sees why the work stopped (a cancel has its notice already).
      if (!controller.signal.aborted) failure.value = `${label} failed: ${messageOf(cause)}`;
    } finally {
      if (current()?.controller === controller) running.value = undefined;
    }
  }
  return {
    running,
    failure,
    notice,
    run,
    /** Reports a failure that has no task (a copy the browser refused, a table that would not drop). */
    fail: (message: string): void => {
      failure.value = message;
    },
    cancel: (): void => {
      const cancelled = running.value;
      cancelled?.controller.abort();
      running.value = undefined;
      if (cancelled) notice.value = `Cancelled "${cancelled.label}".`;
    },
    dismiss: (which: "failure" | "notice"): void => {
      (which === "failure" ? failure : notice).value = undefined;
    },
  };
}

export type Tasks = ReturnType<typeof useTasks>;
