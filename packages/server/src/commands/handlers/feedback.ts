// The feedback commands of 03-api §4.12: the page's feedback notes listed and resolved by an agent or a script, over the
// same store /feedback/ serves (notebook/workspace/feedbackNotes.ts).
import { feedbackList, feedbackUpdate } from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function feedbackHandlers({ feedback }: Services): readonly Bound[] {
  return [
    bind(feedbackList, (request) => feedback.list(request)),
    bind(feedbackUpdate, (request) => feedback.update(request)),
  ];
}
