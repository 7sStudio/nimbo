// The built kernel for the integration stage: the package's dist/index.js, whose createNodeKernel forks its
// default entry, dist/main.js, exactly what users run; a workspace of its own, and the kernel killed at the end.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { onTestFinished } from "vitest";

import type { NodeKernel, NodeKernelOptions } from "../index.js";

type CreateNodeKernel = (options: NodeKernelOptions) => NodeKernel;

const distIndex = new URL("../../dist/index.js", import.meta.url);
const distMain = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

const isCreate = (value: unknown): value is CreateNodeKernel => typeof value === "function";

/** The built package's createNodeKernel; a clear failure when the package was not built. */
export async function loadBuiltKernel(): Promise<CreateNodeKernel> {
  if (!existsSync(distMain)) {
    throw new Error(
      `The integration tests run the built kernel and ${distMain} is missing: run pnpm build first.`,
    );
  }
  const built: unknown = await import(distIndex.href);
  const create: unknown =
    typeof built === "object" && built ? Reflect.get(built, "createNodeKernel") : undefined;
  if (!isCreate(create)) throw new Error(`${distIndex.href} exports no createNodeKernel`);
  return create;
}

/** Runs `fn` with a built kernel over a fresh workspace (not started), killed afterwards, a timed-out test's too. */
export function withBuiltKernel<T>(
  create: CreateNodeKernel,
  fn: (kernel: NodeKernel, ws: Workspace) => Promise<T>,
): Promise<T> {
  return withWorkspace(async (ws) => {
    const kernel = create({ workspace: ws.dir, notebook: "built.jsnb", port: 4321 });
    onTestFinished(() => kernel.kill());
    try {
      return await fn(kernel, ws);
    } finally {
      await kernel.kill();
    }
  });
}
