// The jq worker's entry in a Web Worker: messages in, the jq server, replies out. Loaded only by URL.
import { createJqServer } from "../jq/serve.ts";
import { listenWeb } from "./listen-web.ts";

listenWeb(self, createJqServer());
