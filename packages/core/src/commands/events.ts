// The events command: WebSocket only, so the CLI and the MCP server call it on their own sockets.
import { z } from "zod";

import { NotebookRef } from "../model/ids.js";
import { defineCommand } from "./define.js";

export const eventsSubscribe = defineCommand({
  name: "events.subscribe",
  description:
    "Start receiving events for a notebook, or the whole workspace, on this connection; returns the current seq.",
  input: z.object({ notebook: NotebookRef.optional() }),
  output: z.object({ seq: z.number().int().nonnegative() }),
  tags: { internal: true, streaming: true },
});
