#!/usr/bin/env node
// The `nimbo mcp` process: serveStdio over the real process, then exit with its code, so no keep-alive
// socket to the daemon holds an agent's shutdown. Everything testable is in server/serve.ts and io/process.ts; this
// file is proven by the tests that run the built dist/main.js (mcp:integration).
import { processWorld } from "./io/process.js";
import { serveStdio } from "./server/serve.js";

process.exit(await serveStdio(processWorld()));
