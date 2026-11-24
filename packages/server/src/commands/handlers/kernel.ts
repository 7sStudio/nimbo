// The kernel commands of 03-api §4.4: status, interrupt (INTERRUPT_REFUSED when the kernel refuses), restart (with
// `all`, the client realm too), the scope of either realm, the routes and the tail of the kernel's log.
import {
  kernelInterrupt,
  kernelLog,
  kernelRestart,
  kernelRoutes,
  kernelScope,
  kernelStatus,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function kernelHandlers({ workspace }: Services): readonly Bound[] {
  const session = (notebook: string) => workspace.notebooks.require(notebook);
  return [
    bind(kernelStatus, async ({ notebook }) => (await session(notebook)).kernelStatus()),
    bind(kernelInterrupt, async ({ notebook }) => ({
      interrupted: await (await session(notebook)).interrupt(),
    })),
    bind(kernelRestart, async ({ notebook, all }) => {
      await (await session(notebook)).restart(all);
      return {};
    }),
    bind(kernelScope, async ({ notebook, realm }) => ({
      bindings: await (await session(notebook)).scope(realm),
    })),
    bind(kernelRoutes, async ({ notebook }) => ({ routes: (await session(notebook)).routes() })),
    bind(kernelLog, async ({ notebook, lines }) => {
      const tail = (await session(notebook)).kernelLog(lines);
      return { ...tail, lines: [...tail.lines] };
    }),
  ];
}
