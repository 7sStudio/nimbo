// The answer of kernel.log (03-api §4.4) as the Kernel log tab shows it, or undefined when the command did not
// answer (refused, failed, or a daemon that has no such command).
export type KernelLog = {
  readonly path: string;
  readonly lines: readonly string[];
  readonly truncated: boolean;
};

const isStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((line) => typeof line === "string");

/** `answer` when it has kernel.log's shape. */
export function kernelLogOf(answer: unknown): KernelLog | undefined {
  if (typeof answer !== "object" || answer === null) return undefined;
  const path: unknown = Reflect.get(answer, "path");
  const lines: unknown = Reflect.get(answer, "lines");
  const truncated: unknown = Reflect.get(answer, "truncated");
  return typeof path === "string" && isStrings(lines) && typeof truncated === "boolean"
    ? { path, lines, truncated }
    : undefined;
}
