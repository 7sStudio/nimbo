// The JSON notice lines of a kernel's log (04-kernel §2), one shape for both sides: the child's own (a flow that could
// not send, an error outside any cell) and the daemon side's (a message that failed validation). JSON.stringify is
// captured when the module loads, so a cell that replaces it cannot silence the kernel's notices (04-kernel §3.3).

const stringify = JSON.stringify.bind(JSON);

/** A JSON line for the kernel log: a warning unless `detail` says another level. */
export const notice = (msg: string, detail: Readonly<Record<string, unknown>> = {}): string =>
  stringify({ level: "warn", msg, ...detail });
