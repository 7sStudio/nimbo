// The parts of the Debug Adapter Protocol the daemon reads, as Zod schemas: the answers of the requests it sends and
// the events it follows, validated as they arrive from js-debug.
import type { DebugProtocol } from "@vscode/debugprotocol";
import { z } from "zod";

import { DapFailed } from "./failure.js";

const none = z.unknown();

const Breakpoint = z
  .object({ id: z.number().optional(), verified: z.boolean(), line: z.number().optional() })
  .loose();

const Source = z
  .object({ path: z.string().optional(), presentationHint: z.string().optional() })
  .loose();

export const StackFrame = z
  .object({
    id: z.number(),
    name: z.string(),
    line: z.number(),
    column: z.number(),
    source: Source.optional(),
    presentationHint: z.string().optional(),
  })
  .loose();
export type StackFrame = z.infer<typeof StackFrame>;

const Scope = z
  .object({ name: z.string(), variablesReference: z.number(), expensive: z.boolean() })
  .loose();

export const Variable = z
  .object({
    name: z.string(),
    value: z.string(),
    type: z.string().optional(),
    variablesReference: z.number(),
  })
  .loose();
export type Variable = z.infer<typeof Variable>;

const breakpoints = z.object({ breakpoints: z.array(Breakpoint) }).loose();
const threads = z.object({ threads: z.array(z.object({ id: z.number() }).loose()) }).loose();
const stackTrace = z.object({ stackFrames: z.array(StackFrame) }).loose();
const scopes = z.object({ scopes: z.array(Scope) }).loose();
const variables = z.object({ variables: z.array(Variable) }).loose();
const evaluated = z
  .object({ result: z.string(), type: z.string().optional(), variablesReference: z.number() })
  .loose();

/** The connection a request goes over: DapConnection's untyped send. */
type Sends = {
  readonly send: (command: string, args: unknown, timeoutMs?: number) => Promise<unknown>;
};

/** A request: its arguments in, its answer's body as `R`. */
type Request<A, R> = (connection: Sends, args: A, timeoutMs?: number) => Promise<R>;

/** A request whose answer's body is read with `schema` (DapFailed when it does not fit). */
const request =
  <S extends z.ZodType>(command: string, schema: S) =>
  async (connection: Sends, args: unknown, timeoutMs?: number): Promise<z.output<S>> => {
    const read = schema.safeParse(await connection.send(command, args, timeoutMs));
    if (!read.success) throw new DapFailed(command, "js-debug's answer could not be read");
    return read.data;
  };

type Empty = Record<string, never>;
type Args = DebugProtocol.InitializeRequestArguments;

/** The requests the daemon sends, each with the type of its arguments and what its answer holds. */
export const dap: {
  readonly initialize: Request<Args, unknown>;
  readonly attach: Request<Readonly<Record<string, unknown>>, unknown>;
  readonly configurationDone: Request<Empty, unknown>;
  readonly disconnect: Request<DebugProtocol.DisconnectArguments, unknown>;
  readonly setBreakpoints: Request<
    DebugProtocol.SetBreakpointsArguments,
    z.output<typeof breakpoints>
  >;
  readonly setExceptionBreakpoints: Request<
    DebugProtocol.SetExceptionBreakpointsArguments,
    unknown
  >;
  readonly threads: Request<Empty, z.output<typeof threads>>;
  readonly stackTrace: Request<DebugProtocol.StackTraceArguments, z.output<typeof stackTrace>>;
  readonly scopes: Request<DebugProtocol.ScopesArguments, z.output<typeof scopes>>;
  readonly variables: Request<DebugProtocol.VariablesArguments, z.output<typeof variables>>;
  readonly evaluate: Request<DebugProtocol.EvaluateArguments, z.output<typeof evaluated>>;
  readonly continue: Request<DebugProtocol.ContinueArguments, unknown>;
  readonly pause: Request<DebugProtocol.PauseArguments, unknown>;
  readonly next: Request<DebugProtocol.NextArguments, unknown>;
  readonly stepIn: Request<DebugProtocol.StepInArguments, unknown>;
  readonly stepOut: Request<DebugProtocol.StepOutArguments, unknown>;
} = {
  initialize: request("initialize", none),
  attach: request("attach", none),
  configurationDone: request("configurationDone", none),
  disconnect: request("disconnect", none),
  setBreakpoints: request("setBreakpoints", breakpoints),
  setExceptionBreakpoints: request("setExceptionBreakpoints", none),
  threads: request("threads", threads),
  stackTrace: request("stackTrace", stackTrace),
  scopes: request("scopes", scopes),
  variables: request("variables", variables),
  evaluate: request("evaluate", evaluated),
  continue: request("continue", none),
  pause: request("pause", none),
  next: request("next", none),
  stepIn: request("stepIn", none),
  stepOut: request("stepOut", none),
};

export const StoppedEvent = z
  .object({
    reason: z.string(),
    description: z.string().optional(),
    threadId: z.number().optional(),
    text: z.string().optional(),
  })
  .loose();
export type StoppedEvent = z.infer<typeof StoppedEvent>;

export const BreakpointEvent = z
  .object({ breakpoint: Breakpoint.extend({ source: Source.optional() }) })
  .loose();
export type BreakpointEvent = z.infer<typeof BreakpointEvent>;

/** The configuration a startDebugging reverse request asks the child session to attach with. */
export const StartDebugging = z
  .object({ configuration: z.record(z.string(), z.unknown()) })
  .loose();
