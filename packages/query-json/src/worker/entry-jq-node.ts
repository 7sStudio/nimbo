// The jq worker's entry in Node: worker_threads messages in, the jq server, replies out. Loaded only by URL.
import { parentPort } from "node:worker_threads";

import { createJqServer } from "../jq/serve.ts";
import { listenNode } from "./listen-node.ts";

listenNode(parentPort, createJqServer());
