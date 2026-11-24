// The JSONPath worker's entry in a Web Worker: messages in, the JSONPath server, replies out. Loaded only by URL.
import { createJsonPathServer } from "../jsonpath/serve.ts";
import { listenWeb } from "./listen-web.ts";

listenWeb(self, createJsonPathServer());
