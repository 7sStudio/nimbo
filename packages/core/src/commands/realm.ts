// The realm commands of 03-api §4.5 (the client realm, the notebook page).
import { z } from "zod";

import { realmReportShape } from "../model/bridge.js";
import { NotebookRef } from "../model/ids.js";
import { realmStatusShape } from "../model/notebook.js";
import { defineCommand } from "./define.js";

export const realmStatus = defineCommand({
  name: "realm.status",
  description: "Whether a page is attached, of which kind, and since when.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object(realmStatusShape),
});

export const realmRestart = defineCommand({
  name: "realm.restart",
  description: "Reset the client scope and clear every client cell's output; the page stays.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object({}),
  tags: { destructive: true },
});

export const realmAttach = defineCommand({
  name: "realm.attach",
  description:
    "Called by the page over its WebSocket. The first attach wins; later tabs are view-only until one takes over (takeover), which detaches the first and tells it with realm.reset { takenOver }; a tab takes the realm from the headless page at once. kind headless needs key, the one-time key the daemon gave its own headless page.",
  input: z.object({
    notebook: NotebookRef,
    kind: z.enum(["tab", "headless"]),
    takeover: z.boolean().default(false),
    key: z.string().max(200).optional(),
  }),
  output: z.object({ realmId: z.string() }),
  tags: { internal: true },
});

export const realmDetach = defineCommand({
  name: "realm.detach",
  description: "Detach a realm; also implied by its socket closing.",
  input: z.object({ realmId: z.string() }),
  output: z.object({}),
  tags: { internal: true },
});

export const realmReport = defineCommand({
  name: "realm.report",
  description:
    "The page streams a client cell's outputs, its final status and the names it defined.",
  input: z.object(realmReportShape),
  output: z.object({}),
  tags: { internal: true },
});
