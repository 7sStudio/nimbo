// The kernel child's entry: the daemon forks this file with the child config as argv[2]. The watchdog
// starts first, so from here on no death of the daemon leaves this process running, a spinning cell's included; a
// watchdog that cannot start is a notice in the kernel log, and the kernel starts without it.
import { startKernel } from "./child.js";
import { startWatchdog } from "./watchdog.js";

startWatchdog(process, (line) => process.stderr.write(`${line}\n`));
void startKernel(process); // the kernel lives on its listeners; a failed warm-up is logged and `ready` still sent
