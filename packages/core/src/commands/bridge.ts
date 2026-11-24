// The bridge command of 05-bridge §4 and §9: a stub in the page calls an exported server function.
import { z } from "zod";

import { NotebookRef } from "../model/ids.js";
import { defineCommand } from "./define.js";

export const bridgeCall = defineCommand({
  name: "bridge.call",
  description:
    "Call a current server export with plain-data arguments; the result is plain data or BRIDGE_CALL_FAILED.",
  input: z.object({ notebook: NotebookRef, fn: z.string(), args: z.array(z.unknown()) }),
  // `redacted`: the kernel redacted a secret in the result, so the calling cell gets a stderr warning (04-kernel §10).
  output: z.object({ result: z.unknown(), redacted: z.boolean().optional() }),
  tags: { internal: true },
});
