// The cap on a result: an MCP client reads one message per line and ends the whole session past 10 MiB
// (the SDK's ReadBuffer, `shared/stdio.js`), and no agent can use an answer that size whole: Claude Code refuses a tool
// result past 25 000 tokens (MAX_MCP_OUTPUT_TOKENS) and warns past 10 000. So a result's whole frame (structuredContent
// and its text copy both counted, about twice the text) stays under 128 KiB by default, a text of about 64 KiB, some
// 16 000 to 20 000 tokens of JSON; over it is ResultTooLarge, whose message names the call that reads it in parts.
// The data example's notebook_run answered 790 KB under the old 4 MiB cap, which no agent could read.
/** The cap when the server is given none. */
export const defaultResultLimit = 128 * 1024;

/** A text's size in UTF-8 bytes, as the line carries it. */
export const byteSize = (text: string): number => Buffer.byteLength(text, "utf8");
