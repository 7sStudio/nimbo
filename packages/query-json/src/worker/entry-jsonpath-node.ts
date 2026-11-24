// The JSONPath worker's entry in Node: worker_threads messages in, the JSONPath server, replies out. Loaded only by URL.
import { parentPort } from "node:worker_threads";

import { createJsonPathServer } from "../jsonpath/serve.ts";
import { listenNode } from "./listen-node.ts";

listenNode(parentPort, createJsonPathServer());
