// The daemon process entry that `nimbo open` and `nimbo serve` fork (02-architecture §7): runDaemon against the real
// process, then exit with its code. Everything testable lives in daemonProcess.ts; this file is proven by the tests of
// the built dist/main.js (server:integration).
import { runDaemon } from "./daemonProcess.js";

process.exit(await runDaemon(process.argv.slice(2), process));
