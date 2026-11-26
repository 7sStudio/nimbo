// The public createNodeKernel: the ipc layer's kernel handle composed with the kernel log's redaction,
// which reads the workspace .env through builtins/ and outputs/ (a layer never imports another, so the root does).
import type { NodeKernelOptions } from "./ipc/kernelOptions.js";
import type { NodeKernel } from "./ipc/nodeKernel.js";
import { createKernel } from "./ipc/nodeKernel.js";
import { createLogRedactor } from "./logRedactor.js";

/** A kernel for the notebook of `options`, not started; InvalidParams for options that are not valid. */
export function createNodeKernel(options: NodeKernelOptions): NodeKernel {
  return createKernel(options, createLogRedactor(options.workspace));
}
