// kernel.status of 03-api §4.4 from what the supervisor knows: starting, idle or busy with the executing cell, paused
// while the inspector reports Debugger.paused (04-kernel §9), dead with the exit code or signal.
import type { CellId, KernelState, KernelStatus } from "@jsnb/core";
import { KernelDead } from "@jsnb/core";
import type { Exit } from "@jsnb/kernel-node";

export type KernelFacts = {
  state: KernelState;
  pid: number | null;
  startedAt: string | null;
  inspectorUrl: string | null;
  executing: CellId | null;
  paused: boolean;
  exit: Exit | undefined;
};

/** The facts of a kernel being started. */
export const startingFacts = (): KernelFacts => ({
  state: "starting",
  pid: null,
  startedAt: null,
  inspectorUrl: null,
  executing: null,
  paused: false,
  exit: undefined,
});

function stateOf(facts: KernelFacts): KernelState {
  if (facts.state === "dead" || facts.state === "starting") return facts.state;
  if (facts.paused) return "paused";
  return facts.executing === null ? "idle" : "busy";
}

/** The status `kernel.status` and its event carry. */
export function statusOf(facts: KernelFacts): KernelStatus {
  const state = stateOf(facts);
  return {
    state,
    pid: facts.pid,
    startedAt: facts.startedAt,
    executing: facts.executing,
    inspectorUrl: facts.inspectorUrl,
    ...(state === "dead" ? facts.exit : {}),
  };
}

/** The exit a failed start reports, when it is the kernel's death. */
export const exitOf = (error: unknown): Exit | undefined =>
  error instanceof KernelDead ? error.data : undefined;
