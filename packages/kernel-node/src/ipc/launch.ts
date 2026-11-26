// A kernel's start: the Node check, the workspace loader, the fork awaited until `ready`, then the
// daemon's CDP session with the debugger enabled; a start that fails after the fork or is stopped kills the child.
import { KernelDead } from "@jsnb/core";

import type { Forked, ForkOptions } from "./childProcess.js";
import { forkKernel, killGroup } from "./childProcess.js";
import { InspectorFailed } from "./errors.js";
import type { Cdp } from "./inspector.js";
import { connectCdp } from "./inspector.js";
import type { ResolvedOptions } from "./kernelOptions.js";
import type { Session } from "./kernelState.js";
import { writeLoader } from "./loader.js";
import type { KernelMessage } from "./messages.js";
import { checkNodeVersion } from "./nodeVersion.js";
import { notice } from "./notice.js";

type Ready = Extract<KernelMessage, { type: "ready" }>;

export type LaunchHooks = {
  readonly onLog: (line: string) => void;
  /** Before each chunk of the child's stdout and stderr. */
  readonly onChunk: () => void;
  readonly onMessage: (message: KernelMessage) => void;
  readonly onPause: (paused: boolean) => void;
  /** The fork as soon as it exists, so stop() and kill() reach a child that is not ready yet. */
  readonly onFork: (forked: Forked) => void;
  /** True once stop() or kill() was called: the start then gives up with KernelDead. */
  readonly ended: () => boolean;
};

/**
 * The CDP session of a ready kernel: Debugger.enable so `debugger;` pauses and is reported, and the
 * notice of an exit waiting for this session, which then closes so the kernel can exit (a connected client holds it).
 */
async function connect(ready: Ready, hooks: LaunchHooks): Promise<Cdp> {
  const url = ready.inspectorUrl;
  if (url === undefined) {
    throw new InspectorFailed({
      method: "connect",
      reason: "the kernel reported no inspector URL",
    });
  }
  const cdp = await connectCdp(url, {
    onPause: hooks.onPause,
    onInvalid: (frame) => {
      hooks.onLog(notice("an inspector frame was not CDP and was ignored", { frame }));
    },
  });
  try {
    await cdp.send("Debugger.enable");
    await cdp.send("NodeRuntime.notifyWhenWaitingForDisconnect", { enabled: true });
    return cdp;
  } catch (error) {
    cdp.close();
    throw error;
  }
}

async function attach(forked: Forked, hooks: LaunchHooks): Promise<Session> {
  try {
    const ready = await forked.ready;
    const cdp = await connect(ready, hooks);
    if (!hooks.ended()) return { child: forked.child, ready, cdp };
    cdp.close();
    throw new KernelDead();
  } catch (error) {
    killGroup(forked.child);
    await forked.exited;
    // Stopped during the start: the start reports the stop, whatever broke on the way.
    throw hooks.ended() && !(error instanceof KernelDead)
      ? new KernelDead({}, { cause: error })
      : error;
  }
}

/** forkKernel, a spawn that throws at once (an argument list the system refuses) turned into KernelDead. */
function forkOrFail(options: ForkOptions): Forked {
  try {
    return forkKernel(options);
  } catch (error) {
    throw new KernelDead({}, { cause: error });
  }
}

/** Starts the kernel of `options`; UnsupportedNode, KernelDead, KernelStartTimeout or InspectorFailed when it cannot. */
export async function launch(options: ResolvedOptions, hooks: LaunchHooks): Promise<Session> {
  await checkNodeVersion(options.nodePath);
  await writeLoader(options.workspace);
  if (hooks.ended()) throw new KernelDead();
  const forked = forkOrFail({
    workspace: options.workspace,
    execPath: options.execPath,
    entry: options.entry,
    config: options.config,
    timeoutMs: options.startTimeoutMs,
    onLog: hooks.onLog,
    onChunk: hooks.onChunk,
    onMessage: hooks.onMessage,
  });
  hooks.onFork(forked);
  return attach(forked, hooks);
}
