// The daemon log as every layer sees it (08-code-standards §5): structured fields first, then the message; `child`
// adds the fields a flow knows (`notebook`, `cell`, `execution`). pino's logger is one; this leaf names only what is used.

type Write = (fields: Readonly<Record<string, unknown>>, message: string) => void;

export type Log = {
  readonly error: Write;
  readonly warn: Write;
  readonly info: Write;
  readonly debug: Write;
  readonly child: (fields: Readonly<Record<string, unknown>>) => Log;
};
