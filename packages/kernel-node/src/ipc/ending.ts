// Ending a kernel child (04-kernel §2, §6): stop() asks it to shut down and kills it when it has not exited in time,
// kill() kills it at once, each kill reaching its whole process group (childProcess.ts) and none once the kernel's exit
// was seen; both wait for the exit and mark the kernel ended, so its exit is not reported to onExit.
import type { Exit } from "./childProcess.js";
import { killGroup } from "./childProcess.js";
import type { Context } from "./kernelState.js";

/** Resolves true when `exited` comes within `ms`, false otherwise. */
function exitsWithin(exited: Promise<Exit>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, ms);
    void exited.then(() => {
      clearTimeout(timer);
      resolve(true);
    }); // exited never rejects
  });
}

/** `shutdown`, then SIGKILL when the child has not exited within `waitMs`. */
export async function stopChild(context: Context, waitMs: number): Promise<void> {
  context.state.ended = true;
  const { forked } = context.state;
  if (!forked) return;
  forked.child.send({ type: "shutdown" }, () => undefined); // a closed channel: the exit or the kill ends it
  if (!(await exitsWithin(forked.exited, waitMs))) killGroup(forked.child);
  await forked.exited;
}

/** SIGKILL at once, to the kernel and its group; nothing when its exit was seen. */
export async function killChild(context: Context): Promise<void> {
  context.state.ended = true;
  const { forked } = context.state;
  if (!forked) return;
  killGroup(forked.child);
  await forked.exited;
}
