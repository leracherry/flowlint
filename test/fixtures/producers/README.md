# Recorded producer traces

19 journeys, 918 events, from the AG-UI project's browser integration suite.
These exercise real Strands Python, Strands TypeScript, and LangGraph/DeepAgents
adapters with controlled model responses. They are upstream normalized recordings,
not private production logs, live provider runs, or FlowLint-authored examples.

Source revision: `89cedd3fd549feeee41e50e1d7c6d373e549241a`.
[Manifest](manifest.json) lists each journey's immutable source URL, source SHA-256,
fixture SHA-256, producer suite, and event count. Original MIT terms are retained
in [LICENSE.upstream](LICENSE.upstream).

## How these were recorded

The upstream [recorder](https://github.com/ag-ui-protocol/ag-ui/blob/89cedd3fd549feeee41e50e1d7c6d373e549241a/apps/dojo/e2e/lib/event-trace-recorder.ts)
collects browser response streams, parses SSE, and normalizes generated IDs and
other unstable fields. Its updater writes the `.event-trace.ts` golden journeys.
The suite uses controlled model responses, including
[aimock fixtures](https://github.com/ag-ui-protocol/ag-ui/blob/89cedd3fd549feeee41e50e1d7c6d373e549241a/apps/dojo/e2e/strands-fixtures.ts).

FlowLint's importer reads only literal objects, arrays, shared constants, and the
`defineEventTrace` wrapper with the TypeScript parser. It does not execute upstream
code. It serializes the event objects to NDJSON without changing fields, ordering,
or run boundaries. No additional content redaction or repair was applied.

## Results

| Producer             | Journeys | Result                             |
| -------------------- | -------: | ---------------------------------- |
| Strands Python       |        7 | All clean                          |
| Strands TypeScript   |        3 | All clean                          |
| LangGraph/DeepAgents |        9 | 7 clean; 2 with reopening findings |

Both DeepAgents approval/rejection journeys reopen the `task` and
`request_human_approval` tool calls without their original `parentMessageId`.
FlowLint reports two `ITEM_REOPEN` errors per journey, four total. In the approval
fixture these are zero-based events 38 and 55; in rejection, 38 and 52.
The [pinned tool-call specification](https://github.com/ag-ui-protocol/ag-ui/blob/89cedd3fd549feeee41e50e1d7c6d373e549241a/docs/spec/1.0/events/tool-calls.mdx)
requires reopened calls to retain their parent. It does not require consumers to
detect disagreement, so upstream UI tests can pass while these lint findings
remain valid. We retain the original recordings and assert the findings exactly.
A separate test restores the parents in memory and confirms that all findings
then disappear. This is a derived diagnostic test, not an edited recording.

The recordings cover chat, tool calls/results, reasoning, steps, state/history
snapshots, interrupt/resume, multi-turn memory, nested subagents and subgraphs.
They contain no `STATE_DELTA`, activity, encrypted-value, chunk, or `RUN_ERROR`
events. Those remain covered by authored regression tests; this corpus does not
establish real-producer coverage for them or arbitrary parallel scheduling.

## Reproduce

From the repository root, run:

```sh
pnpm exec vitest run test/producer-traces.test.ts
```

The suite is offline and runs in normal Node 22/24 CI. It verifies fixture hashes,
event counts, exact findings, and equivalent results through JSON and derived SSE
framing. The SSE frames in this test are reconstructed; original transport bytes
are not preserved upstream. Damaged copies test missing ends and partial captures.

To independently regenerate in temporary directories (fetching needs network):

```sh
node scripts/fetch-producer-traces.mjs /tmp/flowlint-producer-sources
node scripts/import-producer-traces.mjs /tmp/flowlint-producer-sources /tmp/flowlint-producer-regenerated
```

Compare the regenerated NDJSON and manifest with this directory. Source downloads
must match recorded checksums. Changing the upstream revision requires reviewing
all source changes, normalization changes, and findings; do not regenerate
expected diagnostics automatically to make failures pass.
