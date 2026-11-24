// Public API of @jsnb/cli: `run(argv, io)`, the nimbo command line generated from the registry plus the shortcuts, and
// the world it runs against.
export { run } from "./run.js";
export type { ExitCode } from "./errors/exit.js";
export type { Io, Opener, SignalName, Spawn } from "./io/io.js";
export { processIo } from "./io/process.js";
