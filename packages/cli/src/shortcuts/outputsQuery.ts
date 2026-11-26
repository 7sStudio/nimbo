// A query of `nimbo outputs`: cell.outputQuery on the daemon (--where read into chips by output-view's
// model, --query, --jq, --sql), with --limit when given. An answer that is not whole is never written in a machine
// format (as ValueCut): one that stopped at its limit or SQL's cap, or whose entries outputs.maxValueBytes cut
// (each holding core's truncated marker), is QueryTruncated, counting the results that came whole; one that ran past
// query.timeoutMs QueryTimedOut, exit 4; pretty shows what came (nothing for a timeout) with the note that says what to
// do. Under --json the answer is printed as it is. A query of a cut value the daemon does not hold is ValueCut with the
// daemon's reason and its advice.
import type { Execution } from "@jsnb/core";
import { cellOutputQuery, InvalidParams, settingsGet, truncatedMarker } from "@jsnb/core";
import { parseFilter } from "@jsnb/output-view/model";

import type { Session } from "../daemon/session.js";
import { InvalidArguments } from "../errors/cli.js";
import { ValueCut } from "../errors/output.js";
import type { TruncatedData } from "../errors/query.js";
import { QueryTimedOut, QueryTruncated, timeoutAdvice, truncatedAdvice } from "../errors/query.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { AskedQuery, Plan } from "./outputsArgs.js";
import type { QueryOutput } from "./outputsFormat.js";
import { queryText } from "./outputsFormat.js";

/** The query's input: --where read into chips by output-view's model (and its node, --at), else the text. */
function queryInput(asked: AskedQuery) {
  if (asked.mode !== "filter") return { mode: asked.mode, query: asked.text };
  const chips = parseFilter(asked.text);
  if (!chips.ok)
    throw new InvalidArguments(
      { argument: "--where", command: "outputs" },
      `--where: ${chips.error.message}`,
    );
  return {
    mode: asked.mode,
    query: [...chips.value],
    ...(asked.at === undefined ? {} : { at: asked.at }),
  };
}

/** cell.outputQuery's own limit when --limit is left out. */
const defaultLimit = cellOutputQuery.input.shape.limit.parse(undefined);

type Answer = QueryOutput & { readonly total: number; readonly truncated: boolean };

/** Whether a node holds core's truncated marker: outputs.maxValueBytes cut it (the slice's marking). */
function holdsCut(node: unknown, depth = 0): boolean {
  if (typeof node !== "object" || node === null || depth > 64) return false;
  if (!Array.isArray(node) && Reflect.get(node, "$type") === truncatedMarker.$type) return true;
  return Object.values(node).some((child) => holdsCut(child, depth + 1));
}

/** The entries of an answer: SQL's rows, the selected nodes, jq's outputs (one, or many). */
function entriesOf(answer: Answer): readonly unknown[] {
  if (answer.mode === "sql") return answer.result.rows ?? [];
  const { value } = answer.result;
  if (answer.mode === "jq" && answer.total <= 1) return [value];
  return Array.isArray(value) ? value : [];
}

/** How many results came whole, and whether the size budget cut some of what came. */
function cameOf(
  answer: Answer,
  limit: number,
): { readonly whole: number; readonly sizeCut: boolean } {
  if (answer.mode === "sql") return { whole: answer.result.rows?.length ?? 0, sizeCut: false };
  const came =
    answer.mode === "jq" ? Math.min(answer.total, limit) : (answer.result.paths?.length ?? 0);
  const whole = entriesOf(answer).filter((entry) => !holdsCut(entry)).length;
  return { whole, sizeCut: whole < came };
}

/** query.sqlMaxRows, which caps every SQL answer whatever its limit: asked when one stopped short. */
async function sqlMaxRows(session: Session): Promise<number | undefined> {
  const { values } = await session.call(settingsGet, { key: "query.sqlMaxRows" });
  const value = values["query.sqlMaxRows"]?.value;
  return typeof value === "number" ? value : undefined;
}

/** The value output a query reads, and how its answer prints. */
export type Target = {
  readonly notebook: string;
  readonly execution: Execution;
  readonly index: number;
  readonly asJson: boolean;
};

/** The daemon's reason when the query's value is cut and not held whole (its words), else undefined. */
function cutReason(error: unknown): string | undefined {
  if (!(error instanceof InvalidParams)) return undefined;
  const [issue] = error.data.issues;
  return issue?.path[0] === "index" && issue.message.startsWith("the full value of output")
    ? issue.message
    : undefined;
}

async function asked(session: Session, target: Target, plan: Plan, query: AskedQuery) {
  const input = {
    notebook: target.notebook,
    cell: plan.cell,
    execution: target.execution.id,
    index: target.index,
    ...queryInput(query),
    ...(plan.limit === undefined ? {} : { limit: plan.limit }),
  };
  try {
    return await session.call(cellOutputQuery, input);
  } catch (error) {
    const reason = cutReason(error);
    if (reason === undefined) throw error;
    const data = { cell: plan.cell, index: target.index, format: plan.format, query: query.mode };
    throw new ValueCut(data, reason, { cause: error });
  }
}

/** The answer printed; pretty of an empty selection would print nothing at all, so a reader sees why on stderr. */
async function writeAnswer(io: Io, answer: Answer, plan: Plan): Promise<void> {
  if (plan.format === "pretty" && answer.total === 0 && answer.mode !== "sql")
    await write(io.stderr, "0 results\n");
  else await write(io.stdout, queryText(answer, plan.format, plan.cell));
}

/** Runs the query and prints its answer, or refuses a machine format of an answer that is not whole. */
export async function ask(
  io: Io,
  session: Session,
  target: Target,
  plan: Plan & { readonly query: AskedQuery },
): Promise<void> {
  const answer = await asked(session, target, plan, plan.query);
  if (target.asJson) {
    await write(io.stdout, `${JSON.stringify(answer)}\n`);
    return;
  }
  const partShown = plan.format === "pretty"; // pretty may show part of an answer, with its note
  const at = { cell: plan.cell, format: plan.format };
  if (answer.timedOut === true) {
    if (!partShown) throw new QueryTimedOut(at);
    await write(io.stderr, `${timeoutAdvice}\n`);
    return;
  }
  if (answer.truncated) {
    const limit = plan.limit ?? defaultLimit;
    const { whole, sizeCut } = cameOf(answer, limit);
    const cut: TruncatedData = {
      ...at,
      shown: whole,
      total: answer.total,
      limit,
      sizeCut,
      ...(answer.mode === "sql" ? { sqlMaxRows: await sqlMaxRows(session) } : {}),
    };
    if (!partShown) throw new QueryTruncated(cut);
    await write(io.stderr, `${truncatedAdvice(cut)}\n`);
  }
  await writeAnswer(io, answer, plan);
}
