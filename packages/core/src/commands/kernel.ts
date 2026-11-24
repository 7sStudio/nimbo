// The kernel commands of 03-api §4.4 (the server realm).
import { z } from "zod";

import { Binding, Route } from "../model/binding.js";
import { CellId, NotebookRef } from "../model/ids.js";
import { kernelStatusShape } from "../model/notebook.js";
import { defineCommand } from "./define.js";

export const kernelStatus = defineCommand({
  name: "kernel.status",
  description: "The kernel's state, pid, start time, the executing cell and the inspector URL.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object(kernelStatusShape),
});

export const kernelInterrupt = defineCommand({
  name: "kernel.interrupt",
  description:
    "Stop whatever is running through the inspector, a synchronous loop included; clear the queue.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object({ interrupted: CellId.nullable() }),
  tags: { mutating: true },
});

export const kernelRestart = defineCommand({
  name: "kernel.restart",
  description:
    "Kill and restart the kernel; server cells become idle and the bridge layer is cleared. With all, also restart the realm.",
  input: z.object({ notebook: NotebookRef, all: z.boolean().default(false) }),
  output: z.object({}),
  tags: { destructive: true },
});

export const kernelLog = defineCommand({
  name: "kernel.log",
  description:
    "The tail of the kernel's log file (.jsnb/logs/kernel-<notebook>.log): its path and its last lines.",
  input: z.object({ notebook: NotebookRef, lines: z.number().int().min(1).max(2000).default(200) }),
  output: z.object({ path: z.string(), lines: z.array(z.string()), truncated: z.boolean() }),
});

export const kernelScope = defineCommand({
  name: "kernel.scope",
  description:
    "What is currently defined in a realm (the server unless realm says client), with a short preview per binding.",
  input: z.object({ notebook: NotebookRef, realm: z.enum(["server", "client"]).default("server") }),
  output: z.object({ bindings: z.array(Binding) }),
});

export const kernelRoutes = defineCommand({
  name: "kernel.routes",
  description:
    "Every route the kernel serves, with the cell that registered it, its URL and a hit count.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object({ routes: z.array(Route) }),
});
