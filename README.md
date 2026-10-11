# FlowLint

Offline linting for AG-UI agent event traces. A small TypeScript library and CLI
that catches stream lifecycle mistakes without starting an agent or calling an LLM.

**Status: milestone 2 implemented.** Runtime schema validation uses the official
`@ag-ui/core/schemas` entry point, pinned to AG-UI core 1.0.2. Explicit run, text
message, and tool-call lifecycles are checked, including complete versus partial
capture boundaries. A successful check means only the documented checks passed;
FlowLint does not provide full protocol conformance certification.

## Run locally

Requires Node.js 22+ and pnpm 10.17.1.

```sh
pnpm install
pnpm build
node dist/cli.js check examples/valid.ndjson
node dist/cli.js check examples/invalid.ndjson --format json
cat examples/valid.ndjson | node dist/cli.js check -
node dist/cli.js check capture.ndjson --allow-partial
```

The installable package exposes a `flowlint` executable. The intended npm package
name is `@leracherry/flowlint`; it has not been published or checked for availability.
The FlowLint name is also used by unrelated [n8n](https://flowlint.dev/) and
[Python](https://github.com/js-lover/flowlint) projects.

## Inputs and output

Accepts NDJSON, JSON event arrays, or stdin (`-`). Blank NDJSON lines are ignored.
Auto detection treats a leading `[` as a JSON array; `--input ndjson|json` overrides
it. SSE transcripts require a future parser and are not supported.

`--format pretty|json` selects output. Diagnostics carry a code, severity,
zero-based event index and one-based line/column. JSON array locations point to
individual array items. Schema-invalid events are reported and skipped safely.
Parse errors use `PARSE_*`; event schema errors use `SCHEMA_EVENT`.

Exit codes: **0** no errors, **1** schema or lint errors, **2** input/parse/usage
failure. Warnings do not cause failure. Reads are limited to 10 MiB and diagnostics
to 1,000 findings plus a limit notice. Diagnostics omit message bodies and tool
arguments; message identifiers remain visible. Checks run offline after installation.

## Library

```ts
import { lintEvents, parseTrace } from "@leracherry/flowlint";

const records = parseTrace(traceText, { format: "ndjson" });
const result = lintEvents(records, {
  protocol: "ag-ui/1.0",
  allowPartial: false,
});
console.log(result.valid, result.diagnostics);
```

The canonical input to `lintEvents` is a source-aware `SourceEvent[]`, returned by
`parseTrace`. The result includes `protocol`, `checkedEvents`, `supportedRules`,
`valid`, and `diagnostics`. `TraceInputError` exposes a safe code and location.

## Current coverage

| Code           | Check                                                                 |
| -------------- | --------------------------------------------------------------------- |
| FL001          | Stream starts without `RUN_STARTED` or `RUN_ERROR`                    |
| FL002          | Explicit text content/end references a message that is not open       |
| FL003          | Explicitly opened text message remains open at `RUN_FINISHED`         |
| FL004          | Tool call starts while its ID is already open                         |
| FL005          | Explicit tool arguments/end references a tool call that is not open   |
| FL006          | New run starts while the prior run is active                          |
| FL007          | A run ID is reused for another run on the same thread                 |
| FL008          | Text message starts while its ID is already open                      |
| FL009          | Explicitly opened tool call remains open at `RUN_FINISHED`            |
| FL012          | Capture ends without a terminal event or with open items              |
| RUN_TRANSITION | Event follows a closed run illegally, or finish has no observed start |
| RUN_IDENTITY   | Finish identifiers differ from the active run                         |

Messages and tool calls are independent, so interleaving is legal. Closed items
can be reopened. Run ID history is tracked separately for each thread. Event
arrival order is authoritative, regardless of timestamps. Diagnostics are ordered
by source event index and code; closure findings point to the terminal event and
EOF findings point to the last schema-valid event.

`RUN_ERROR` abandons open items without closure findings. A late `RUN_ERROR` after
`RUN_FINISHED` is accepted; after `RUN_ERROR`, only a new `RUN_STARTED` is legal.
Cancelled and interrupted finishes require closed items but do not require a
resuming run in the same trace. `TOOL_CALL_END` ends argument streaming; a tool
result is not required. Arguments are never parsed as JSON.

### Complete and partial captures

Complete mode is the default: an opening boundary and a terminal run event are
required. `--allow-partial` downgrades uncertain findings at the opening capture
boundary and EOF truncation to warnings. Missing item openers can be outside an
excerpt until an observed run start establishes a complete scope. An observed
item end proves subsequent content without a new start is an error. Duplicate
starts, reused run IDs, observed run-transition contradictions, and items still
open at an observed finish remain errors in partial mode.

```sh
node dist/cli.js check examples/interleaved.ndjson
node dist/cli.js check examples/partial.ndjson --allow-partial --format json
```

### Coverage limits and next milestone

Chunk normalization (`FL010`/`FL011`) is milestone 3. Text/tool chunk events emit
`COVERAGE_CHUNKS` and suspend that family's item checks for the rest of the run.
Subagent events or attributed items emit `COVERAGE_SUBAGENTS` and suspend both
text/tool families, since tool ownership can be implicit through a parent message.
Run boundaries and EOF checks still apply. These warnings mean some sequencing
checks were skipped; they do not establish that the unchecked events are correct.
A new run restores item checking.

Reasoning, steps, state patches, item-reopening attributes, and subagent lifecycles
are not sequence-checked. Their event shapes still undergo official schema
validation. See [ROADMAP.md](ROADMAP.md) for milestone progress.

## Development and releases

```sh
pnpm check
pnpm format
```

GitHub Actions runs formatting/lint, strict typechecking, tests, and build on
Node 22 and 24 for main and pull requests. Pushing a version tag matching
`package.json` runs release checks and creates a GitHub Release containing the
installable package and checksums. npm publishing is not configured.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the release process and next milestones.

Protocol references: [AG-UI event model](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/basic/index.mdx)
and [streaming rules](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/basic/patterns/streaming.mdx).

MIT licensed.
