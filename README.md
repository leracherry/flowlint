# FlowLint

Offline linting for AG-UI agent event traces. A small TypeScript library and CLI
that catches stream lifecycle mistakes without starting an agent or calling an LLM.

**Status: milestone 4 implemented.** Runtime schema validation uses the official
`@ag-ui/core/schemas` entry point, pinned to AG-UI core 1.0.2. Explicit run, text
message, and tool-call lifecycles are checked, including text/tool shorthand
normalization and complete versus partial capture boundaries. A successful check
means only the documented checks passed;
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
it. Each invocation accepts exactly one file or stdin, with paths resolved from
the current directory. Directories and additional paths are rejected. FlowLint
does not expand globs: pass a concrete path and quote it if it contains spaces.
SSE transcripts require a future parser and are not supported.

`--format pretty|json` selects output. Diagnostics carry a code, severity,
zero-based event index and one-based line/column. JSON array locations point to
individual array items. Schema-invalid events are reported and skipped safely.
Parse errors use `PARSE_*`; event schema errors use `SCHEMA_EVENT`.

Pretty output aligns location, severity, and code columns. Colors appear only
when stdout is a terminal and `NO_COLOR` is absent; redirected output is always
plain, even with `FORCE_COLOR`. Setting `NO_COLOR` (including an empty value)
disables color. JSON is always uncolored, follows the library `LintResult` shape,
and ends with a newline. All reports go to stdout, so CI can save them:

```sh
node dist/cli.js check examples/invalid.ndjson --format json > findings.json
```

The command above exits 1 because the example is invalid. JSON output also covers
input, parse, and usage failures (`INPUT_READ`, `PARSE_*`, `CLI_USAGE`), with
`checkedEvents: 0` when checking could not begin. `--help` and `--version` produce
normal text and exit 0. Invoking `flowlint` without a command shows help and exits 2.
Unknown commands/options or extra file arguments exit 2.

For example, checking the invalid trace produces:

```text
examples/invalid.ndjson
AG-UI 1.0; FlowLint supported rules: 14 (FL001, FL002, FL003, FL004, FL005, FL006, FL007, FL008, FL009, FL010, FL011, FL012, RUN_TRANSITION, RUN_IDENTITY)

  2:1  error  FL002  TEXT_MESSAGE_CONTENT refers to unopened text message "m-2"

1 error, 0 warnings (3 events checked)
```

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
`formatPretty(result, source)` and `formatJson(result)` are also exported for
integrations; both return strings without a trailing newline. The pretty formatter
is plain by default; `{ color: true }` explicitly enables ANSI styling for callers
that have already checked their output destination.

## Current coverage

| Code           | Check                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| FL001          | Stream starts without `RUN_STARTED` or `RUN_ERROR`                       |
| FL002          | Explicit text content/end references a message that is not open          |
| FL003          | Explicitly opened text message remains open at `RUN_FINISHED`            |
| FL004          | Tool call starts while its ID is already open                            |
| FL005          | Explicit tool arguments/end references a tool call that is not open      |
| FL006          | New run starts while the prior run is active                             |
| FL007          | A run ID is reused for another run on the same thread                    |
| FL008          | Text message starts while its ID is already open                         |
| FL009          | Explicitly opened tool call remains open at `RUN_FINISHED`               |
| FL010          | Opening text/tool chunk omits required fields                            |
| FL011          | Chunk continuation conflicts, mixes forms, or ambiguously targets a lane |
| FL012          | Capture ends without a terminal event or with open items                 |
| RUN_TRANSITION | Event follows a closed run illegally, or finish has no observed start    |
| RUN_IDENTITY   | Finish identifiers differ from the active run                            |

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

### Chunk shorthand

Text and tool chunks expand into start/content/end transitions before lifecycle
checks. The first text chunk requires `messageId`; an omitted role means
`assistant`. The first tool chunk requires `toolCallId` and `toolCallName`.
Continuations can omit opening fields or repeat them consistently. Repeating a
conflicting role, name, tool name, parent message, or owner produces `FL011`.
Naming a different identifier opens a new item and closes the previous one;
a new tool item must provide its own tool name.

A message/tool/step/state/custom/reasoning event closes shorthand in its lane.
Run boundaries and `MESSAGES_SNAPSHOT` close every lane. `RAW`, activity events,
`REASONING_ENCRYPTED_VALUE`, and `SUBAGENT_STARTED` leave assembly open. A
subagent terminal closes that subagent's lane. Explicit items remain independent
of shorthand; mixing explicit and chunk forms inside one open item is invalid.
EOF remains truncation, not a synthesized successful finish.

Tagged lanes, identifier-based ownership, and tool ownership inherited from a
known parent message are supported for text/tool chunk assembly. An untagged,
identifier-free continuation prefers the parent's open stream of that family,
then the sole child stream. Multiple possible child streams produce `FL011`.
Metadata-only chunks are accepted; FlowLint does not validate metadata merge
semantics or assemble message bodies. Synthetic transitions preserve the source
location of the chunk or event that caused them. Event counts refer to original
input events, not expanded transitions.

```sh
node dist/cli.js check examples/chunks.ndjson
```

In partial captures, a chunk opener missing before the capture can produce an
uncertain `FL010` warning. An observed run start or lane-closing event establishes
a boundary, making subsequent missing required fields errors. Conflicting repeats,
ambiguous lanes, and mixed forms remain errors in partial mode.

### Coverage limits and next milestone

Reasoning chunks produce `COVERAGE_REASONING`: they are schema-validated but are
not normalized or lifecycle-checked. Reasoning/step/subagent lifecycles, state
patch application, and item-reopening attributes remain outside sequence coverage.
Their event shapes still undergo official schema validation.

Subagent events or attributed items produce `COVERAGE_SUBAGENTS`. Text/tool chunk
assembly and FL010/FL011 still run, but explicit text/tool lifecycle checks are
suspended for that run pending full attribution support. These warnings mean some
checks were skipped; they do not establish that the unchecked events are correct.
A new run restores explicit item checking.

Milestones 0–4 are implemented; milestone 5 is release preparation. See
[ROADMAP.md](ROADMAP.md) for progress.

## Use in GitHub Actions

For traces stored in a FlowLint checkout, copy this to
`.github/workflows/lint-trace.yml`. Replace `TRACE_FILE` with your recorded trace.
The final step fails the job on a lint error or input failure; warnings pass.
This example builds from source and works before npm publication.

```yaml
name: Lint agent trace
on: [push, pull_request]
permissions:
  contents: read
jobs:
  lint-trace:
    runs-on: ubuntu-24.04
    env:
      TRACE_FILE: examples/valid.ndjson
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: node dist/cli.js check "$TRACE_FILE"
```

In another project, install a FlowLint GitHub Release tarball when one is
available, or build a separate FlowLint checkout and invoke its `dist/cli.js` with
the path to your trace. Access to this private source repository requires GitHub
authorization. The npm package is not yet available.

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
