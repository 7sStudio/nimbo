// The feedback commands of 03-api §4.12: the notes the page's feedback mode left on the running app, kept
// in the workspace's `.jsnb/feedback/`, read and resolved by an agent or a script the way the page's Show Feedback list
// does (feedback.jsonl holds every detail; FEEDBACK.md is the same list as Markdown).
import { z } from "zod";

import { defineCommand } from "./define.js";

const status = z.enum(["open", "done"]);

/** One note as an agent reads it: what was said, where it points and its screenshots' paths. */
export const FeedbackNote = z
  .object({
    id: z.string(),
    /** When it was saved, ISO 8601. */
    at: z.string(),
    status,
    text: z.string(),
    /** Where it points, in words: the page, the cell and the last Vue components (`a.jsnb · cell 2 (server) · …`). */
    where: z.string(),
    selector: z.string(),
    /** The page's route, the notebook (empty on Home) and the cell the element is in. */
    page: z.object({
      kind: z.string(),
      path: z.string(),
      notebook: z.string(),
      cell: z.object({ id: z.string(), index: z.number(), type: z.string() }).optional(),
    }),
    /** The screenshots as absolute paths. */
    shots: z.object({ element: z.string().optional(), viewport: z.string().optional() }),
    /** The app's build when the note was left. */
    app: z.object({ version: z.string(), commit: z.string() }),
    /** With `full`: the element (tag, text, outerHTML, box, computed styles), the component path and the area. */
    element: z.unknown().optional(),
    components: z.array(z.string()).optional(),
    area: z.unknown().optional(),
  })
  .readonly();
export type FeedbackNote = z.infer<typeof FeedbackNote>;

export const feedbackList = defineCommand({
  name: "feedback.list",
  description:
    "The UI feedback notes left on the running app (Cmd Alt F), newest first: the open ones unless status says otherwise; with full, each one's element, outerHTML, styles and component path too. Answers the folder they are kept in.",
  input: z.object({
    status: z.enum(["open", "done", "all"]).default("open"),
    full: z.boolean().default(false),
  }),
  output: z.object({ dir: z.string(), notes: z.array(FeedbackNote).readonly() }),
});

export const feedbackUpdate = defineCommand({
  name: "feedback.update",
  description:
    "Mark a feedback note done once it is fixed (or open again), or change its text; the page's list and FEEDBACK.md follow.",
  input: z.object({
    id: z.string().min(1),
    status: status.optional(),
    text: z.string().trim().min(1).optional(),
  }),
  output: z.object({ note: FeedbackNote }),
  tags: { mutating: true, idempotent: true },
});
