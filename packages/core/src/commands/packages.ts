// The packages commands: list, add, remove and cancel.
import { z } from "zod";

import { defineCommand } from "./define.js";

const installed = z.array(z.object({ name: z.string(), version: z.string() }));

export const packagesList = defineCommand({
  name: "packages.list",
  description: "The packages of the workspace package.json.",
  input: z.object({}),
  output: z.object({ packages: installed }),
});

export const packagesAdd = defineCommand({
  name: "packages.add",
  description:
    "Run the package manager in the workspace; progress arrives as packages.progress events.",
  input: z.object({ names: z.array(z.string().min(1)).min(1) }),
  output: z.object({ added: installed }),
  tags: { mutating: true, streaming: true },
});

export const packagesRemove = defineCommand({
  name: "packages.remove",
  description:
    "Remove packages the workspace package.json declares, through its package manager; progress arrives as packages.progress events.",
  input: z.object({ names: z.array(z.string().min(1)).min(1) }),
  output: z.object({ removed: z.array(z.string()) }),
  tags: { mutating: true, streaming: true },
});

export const packagesCancel = defineCommand({
  name: "packages.cancel",
  description:
    "Stop an add or remove: the one of names, queued or under way, else the one under way. A queued one never runs; one under way has its process group killed. Either call fails PackagesCancelled, with started: true when the manager had run, in which case what it wrote before stays.",
  input: z.object({ names: z.array(z.string().min(1)).min(1).optional() }),
  output: z.object({ cancelled: z.array(z.string()) }),
  tags: { mutating: true },
});
