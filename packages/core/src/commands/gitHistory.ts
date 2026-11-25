// The history of Source Control (03-api §4.15): the log of a branch or of one file, paged, and one commit's changed
// files. A commit's notebook diff is git.diff with commit (against its parent) or base (against the working copy).
import { z } from "zod";

import { GitCommitDetail, GitCommitSummary } from "../model/gitHistory.js";
import { defineCommand } from "./define.js";

export const gitLog = defineCommand({
  name: "git.log",
  description:
    "The commits of ref (HEAD by default), newest first, each with author, date and subject; path keeps those that changed that file (following its renames). Pages with skip and limit; more says whether older ones follow. Empty before the first commit.",
  input: z.object({
    ref: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    skip: z.number().int().nonnegative().default(0),
    limit: z.number().int().positive().max(500).default(50),
  }),
  output: z.object({ commits: z.array(GitCommitSummary).readonly(), more: z.boolean() }),
});

export const gitShow = defineCommand({
  name: "git.show",
  description:
    "One commit: its author, date, subject and body, and the files it changed under the workspace folder against its first parent (git.diff with commit and path gives one file's diff, a notebook's cell by cell).",
  input: z.object({ commit: z.string().min(1) }),
  output: GitCommitDetail,
});
