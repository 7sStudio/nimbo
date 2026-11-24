// The query bar's cheat sheet (11-query §4: `?` opens ten examples for the mode), written against Stripe-like events.
import type { QueryMode } from "@jsnb/core";

/** One example: the query and what it does, in a few words. */
export type Example = { readonly query: string; readonly says: string };

/** Ten examples per mode, the simplest first. */
export const examples: Readonly<Record<QueryMode, readonly Example[]>> = {
  filter: [
    { query: "status = succeeded", says: "children whose status is succeeded" },
    { query: "amount > 1000", says: "a number above 1000" },
    { query: "amount >= 1000, currency = usd", says: "both conditions" },
    { query: "metadata.plan exists", says: "the key is there" },
    { query: "email contains @example.com", says: "text inside" },
    { query: "id startsWith evt_", says: "text at the start" },
    { query: "type matches ^charge\\.", says: "a regular expression" },
    { query: "livemode = false", says: "a boolean" },
    { query: 'note = "a, b"', says: "quote a value with a comma" },
    { query: "['first name'] = Ada", says: "a key with a space" },
  ],
  jsonpath: [
    { query: "$.data[*].id", says: "every id" },
    { query: "$..email", says: "every email, at any depth" },
    { query: "$.data[0:10]", says: "the first ten items" },
    { query: "$.data[-1]", says: "the last item" },
    { query: '$.data[?@.status == "succeeded"]', says: "items with that status" },
    { query: '$.data[?@.amount > 1000 && @.currency == "usd"]', says: "two conditions" },
    { query: "$.data[?@.metadata.plan]", says: "items that have the key" },
    { query: '$.data[?search(@.id, "^ch_")]', says: "a pattern inside" },
    { query: '$.data[?match(@.type, "charge\\\\..*")]', says: "a whole-text pattern" },
    { query: "$.data[?length(@.lines.data) > 1]", says: "more than one line" },
  ],
  jq: [
    { query: ".data[] | .id", says: "every id" },
    { query: ".data | length", says: "how many" },
    { query: "keys", says: "the top-level keys" },
    { query: ".data[] | select(.amount > 1000)", says: "items over 1000" },
    { query: ".data | map({id, amount})", says: "two fields of each" },
    { query: "[.data[].amount] | add", says: "the total" },
    { query: ".data | sort_by(.created) | reverse | .[0]", says: "the newest" },
    {
      query: ".data | group_by(.type) | map({type: .[0].type, n: length})",
      says: "a count per type",
    },
    { query: '.data[] | select(.status == "failed") | .id', says: "the failed ids" },
    { query: ".data | map(.created | todate)", says: "unix times as dates" },
  ],
  sql: [
    { query: "SELECT * FROM t LIMIT 10", says: "the first ten rows" },
    { query: "SELECT count(*) FROM t", says: "how many rows" },
    { query: "SELECT id, amount FROM t WHERE amount > 1000", says: "two columns, filtered" },
    {
      query: "SELECT type, count(*) AS n FROM t GROUP BY 1 ORDER BY 2 DESC",
      says: "a count per type",
    },
    {
      query: "SELECT currency, sum(amount) FROM t GROUP BY currency",
      says: "a total per currency",
    },
    { query: "SELECT avg(amount) FROM t", says: "the mean" },
    { query: "SELECT data.object.amount FROM t", says: "a field of a nested object" },
    { query: "SELECT * FROM t WHERE id LIKE 'evt_%'", says: "a text pattern" },
    {
      query: "SELECT to_timestamp(created) AS at, id FROM t ORDER BY created DESC",
      says: "unix times as dates",
    },
    {
      query: "SELECT * FROM t WHERE status IN ('failed', 'canceled')",
      says: "one of several values",
    },
  ],
};
