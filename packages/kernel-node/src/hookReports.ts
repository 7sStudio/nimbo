// What the kernel does with the process hooks after user code, on its interval and in its interrupt hook: the checks of processHooks.ts, each probe's call of a replacement run under the store of the cell it would
// blame (so an interrupt of that cell can stop a replacement that spins), then each finding reported: one notice in the
// kernel log and a ProcessHookReplaced error output on that cell; a hook Node's own could not be put back on leaves a
// kernel that cannot hear the daemon, which ends instead.
import type { ErrorInfo } from "@jsnb/core";

import { ProcessHookReplaced } from "./builtins/errors.js";
import { notice } from "./ipc/notice.js";
import type { Sink, StreamName } from "./outputs/sink.js";
import type { HookFinding, ProcessHooks } from "./processHooks.js";
import type { Store, Stores } from "./store.js";

export type HookCheckDeps = {
  readonly hooks: ProcessHooks;
  readonly notebook: string;
  /** Writes to the daemon's kernel log. */
  readonly log: (stream: StreamName, text: string) => void;
  /** Ends the process at once, whatever is still being sent. */
  readonly exit: (code: number) => void;
  readonly stores: Stores;
  readonly sink: Sink;
  readonly errorInfo: (error: unknown) => ErrorInfo;
};

/**
 * After user code that ran under `store`: a process hook it replaced with one that does not deliver is put back, with
 * one notice and an error output on `store`; resolves once decided, and is undefined when nothing differs.
 */
export type CheckHooks = (store: Store | undefined) => Promise<void> | undefined;

/** The two checks: `check` after user code and on the interval, `recheck` in the interrupt hook (kept ones probed too). */
export type HookChecks = { readonly check: CheckHooks; readonly recheck: CheckHooks };

/** What one finding does: the notice, then the error output on the cell, or the end of a kernel that stays deaf. */
function reporter(deps: HookCheckDeps) {
  return (store: Store | undefined, { name, restored }: HookFinding): void => {
    const msg = restored
      ? `${name} was replaced by a function or an accessor that does not deliver, so the kernel put Node's own back`
      : `${name} was replaced by a function or an accessor that does not deliver and cannot be put back, so the kernel ends`;
    const where = store ? { cell: store.cell } : {};
    const level = restored ? "warn" : "error";
    deps.log("stderr", `${notice(msg, { level, notebook: deps.notebook, ...where })}\n`);
    if (!restored) {
      deps.exit(1);
      return;
    }
    const error = deps.errorInfo(new ProcessHookReplaced({ name }));
    if (store) deps.sink.emit(store, { kind: "error", error });
  };
}

/** Reports each finding once the probes decided. */
async function reported(
  decided: Promise<readonly HookFinding[]>,
  report: (finding: HookFinding) => void,
): Promise<void> {
  for (const finding of await decided) report(finding);
}

/** The checks of the process hooks over `deps`. */
export function createHookChecks(deps: HookCheckDeps): HookChecks {
  const report = reporter(deps);
  const over =
    (check: ProcessHooks["check"]): CheckHooks =>
    (store) => {
      const decided = check((call) => {
        deps.stores.run(store, call);
      });
      return (
        decided &&
        reported(decided, (finding) => {
          report(store, finding);
        })
      );
    };
  return { check: over(deps.hooks.check), recheck: over(deps.hooks.recheck) };
}
