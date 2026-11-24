# Examples

Five tutorial notebooks ship with the app. Each opens with what you will learn and how long it takes, then alternates short steps in prose with cells to run, and ends with "Try this next".

| Notebook                    | What it shows                                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-data.jsnb`              | Generate a few thousand orders on the server and read them with every data view: the tree and raw JSON, the grid's sort and filters, the seven-line cap with Expand and Pin, JSONPath and jq on the daemon, SQL with DuckDB, filter chips, export, a large value full screen. |
| `02-client-ui.jsnb`         | Build a small interface in the page with client cells: `display`, events and state shared by several cells, a timer that cleans up after itself, an SVG chart, and what the Inspector shows of client names.                                                                  |
| `03-payments.jsnb`          | A payment with Stripe from end to end: a server cell that creates the PaymentIntent, a route that receives the webhook, a client cell that calls the exported function and mounts the result. With no `STRIPE_SECRET_KEY` it runs on samples its own code makes, and says so. |
| `04-routes-and-agents.jsnb` | A small HTTP API served from the notebook and called with curl, the Activity log and the Console, a failing cell and how to recover, and an agent's edit shown for review.                                                                                                    |
| `05-vue.jsnb`               | Vue 3 in client cells: reactive state in a cell of its own, a component with props and emits, an app with `v-model`, `watch` and lifecycle hooks that a re-run unmounts, a composable, and a component that calls a server function.                                          |

## Where they live

The files are in [`packages/server/examples/`](../packages/server/examples), the one source: the server package's `files` carries that folder into an installed copy, and the daemon reads it from there (`examples.list`, `examples.copy`, 03-api §4.11). Nothing else holds a copy.

## Opening one

From Home, the Workspace panel's Examples lists them; a click copies the notebook into the workspace folder (a name already taken gets the next number, as `01-data-2.jsnb`) and opens the copy, so the shipped file is never changed. The palette offers each too, as "Open a copy of the example: …". From a terminal, in the workspace folder:

```bash
nimbo examples copy --name 01-data   # starts the daemon when none runs, prints the copy's path
nimbo open 01-data.jsnb
nimbo examples list                  # with the daemon running
```

## What they need

Nothing to install and no network, except `05-vue`, which needs the `vue` package: its first client cell stops on `MissingPackage` with Install, and once installed Run all works offline. Client cells run in the page, so keep the notebook's tab open. `03-payments` makes real test-mode calls only once you set `STRIPE_SECRET_KEY` (a `sk_test_` key) and add the `stripe` package in the Environment view; until then every Stripe answer is a sample its own code makes, labelled "sample response, no STRIPE_SECRET_KEY set". Its package is loaded by a name held in a variable, so Run all works before it is installed.

## They cannot rot

`packages/server/src/files/examples/examples.integration.test.ts` holds each file to the file format's exact form, copies each into a fresh workspace on a real daemon and kernel, runs it with Run all and requires every server cell to end well with no error output (the client cells are listed as skipped there, since they need the page), and every query a cell pins to answer on the daemon. The layout quality journey (`packages/ui/e2e/quality-layout.spec.ts`) opens the client example from Home's Examples entry and runs it in the built page, every client cell ending live.
