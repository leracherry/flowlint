# FlowLint reference

Detailed CLI behavior, supported rules, and protocol coverage. See the
[compatibility policy](COMPATIBILITY.md) for versioning guarantees and the
machine-readable interfaces supported for automation.

## Inputs and output

Accepts NDJSON, JSON event arrays, SSE, or stdin (`-`). Blank NDJSON lines are ignored.
Auto detection treats a leading `[` as a JSON array; `--input ndjson|json` overrides
it. `--input sse` explicitly selects an SSE capture. Each invocation accepts exactly one file or stdin, with paths resolved from
the current directory. Directories and additional paths are rejected. FlowLint
does not expand globs: pass a concrete path and quote it if it contains spaces.
SSE captures contain response bodies only, without HTTP headers. See the SSE
section below for framing and truncation behavior.

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
AG-UI 1.0; FlowLint supported rules: 31 (FL001, FL002, FL003, FL004, FL005, FL006, FL007, FL008, FL009, FL010, FL011, FL012, RUN_TRANSITION, RUN_IDENTITY, SUBAGENT_START, SUBAGENT_END, SUBAGENT_PARENT, SUBAGENT_OPEN, ATTRIBUTION, REASONING_SPAN_START, REASONING_SPAN_END, REASONING_SPAN_OPEN, REASONING_MESSAGE_START, REASONING_MESSAGE_MISSING, REASONING_MESSAGE_OPEN, STEP_START, STEP_END, STEP_OPEN, STATE_PATCH, STATE_BASELINE, STATE_LIMIT)

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

| Code                      | Check                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- |
| FL001                     | Stream starts without `RUN_STARTED` or `RUN_ERROR`                              |
| FL002                     | Explicit text content/end references a message that is not open                 |
| FL003                     | Explicitly opened text message remains open at `RUN_FINISHED`                   |
| FL004                     | Tool call starts while its ID is already open                                   |
| FL005                     | Explicit tool arguments/end references a tool call that is not open             |
| FL006                     | New run starts while the prior run is active                                    |
| FL007                     | A run ID is reused for another run on the same thread                           |
| FL008                     | Text message starts while its ID is already open                                |
| FL009                     | Explicitly opened tool call remains open at `RUN_FINISHED`                      |
| FL010                     | Opening text/tool/reasoning chunk omits required fields                         |
| FL011                     | Text/tool ownership conflicts; chunk conflicts, mixed forms, or ambiguous lanes |
| FL012                     | Capture ends without a terminal event or with open items                        |
| RUN_TRANSITION            | Event follows a closed run illegally, or finish has no observed start           |
| RUN_IDENTITY              | Finish identifiers differ from the active run                                   |
| SUBAGENT_START            | Duplicate/reused invocation ID or announcement after attributed output          |
| SUBAGENT_END              | Subagent terminal without an active invocation                                  |
| SUBAGENT_PARENT           | Nested invocation names an unannounced parent                                   |
| SUBAGENT_OPEN             | Run finishes with an announced invocation still active                          |
| ATTRIBUTION               | Reasoning/activity ownership or step attribution disagrees with its opener      |
| REASONING_SPAN_START      | Reasoning span starts while its ID is open                                      |
| REASONING_SPAN_END        | Reasoning span ends without an open span                                        |
| REASONING_SPAN_OPEN       | Reasoning span remains open at run finish                                       |
| REASONING_MESSAGE_START   | Reasoning message starts while its ID is open                                   |
| REASONING_MESSAGE_MISSING | Reasoning content/end refers to an unopened message                             |
| REASONING_MESSAGE_OPEN    | Reasoning message remains open at run finish                                    |
| STEP_START                | Step starts while the same owner's step name is open                            |
| STEP_END                  | Step finishes without an open step for that owner                               |
| STEP_OPEN                 | Step remains open at run finish                                                 |
| STATE_PATCH               | Well-formed patch cannot apply; warn and retain prior state                     |
| STATE_BASELINE            | No recorded state baseline; patch applicability is unknown                      |
| ACTIVITY_PATCH            | Activity patch cannot apply; warn and retain prior content                      |
| ACTIVITY_BASELINE         | Activity baseline missing or no longer verified                                 |
| ITEM_REOPEN               | Reopened message/tool attributes disagree with the established item             |
| ENCRYPTED_TARGET          | No recorded compatible message or tool target; warning                          |
| ENCRYPTED_PRESERVATION    | Later recorded input omits or changes a retained artifact; warning              |
| ENCRYPTED_SUBTYPE         | Unknown string subtype; warn and skip the encrypted event                       |
| ACTIVITY_CONTENT          | Patched activity content would not be an object                                 |
| ACTIVITY_LIMIT            | Activity validation exceeded its shared resource budget                         |
| STATE_LIMIT               | State validation exceeded its resource budget                                   |

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

Text, tool, and reasoning chunks expand into start/content/end transitions before lifecycle
checks. The first text chunk requires `messageId`; an omitted role means
`assistant`. The first reasoning chunk also requires `messageId`, with role
`reasoning`. The first tool chunk requires `toolCallId` and `toolCallName`.
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

### Coverage limits

FlowLint checks recorded protocol transitions, not a consumer’s internal storage
or provider behavior. It does not decrypt encrypted values, assemble message
bodies, validate metadata merging, or certify full protocol conformance. Event
shapes use the pinned schema; unknown encrypted subtype strings receive the
forward-compatibility handling described below.

### Reopened items and encrypted artifacts

These checks are available on `main` for the next release. They follow the
[message](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/events/text-messages.mdx),
[tool](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/events/tool-calls.mdx),
and [reasoning](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/events/reasoning.mdx)
requirements.

`ITEM_REOPEN` checks message role/name/ownership and tool name/parent/ownership.
The default text role is `assistant`; omitted names and parents count as
established values. Checks apply after chunk expansion and across runs on the
same thread. Existing duplicate-start and attribution rules remain active.
Snapshots and included input messages establish authoritative replacement
attributes. Observed contradictions remain errors in partial captures; an unseen
original opener does not establish attributes to compare.

`REASONING_ENCRYPTED_VALUE` targets an observed message or tool call in its own
namespace. Open and closed items, recorded history, reasoning messages, and tool
result messages can be targets. Reasoning spans and activities cannot.
`ENCRYPTED_TARGET` warns when a compatible target is not recorded, including in
partial captures. The value opens or closes no stream and replaces any previous
artifact for that target.

When a subsequent `RUN_STARTED` includes recorded input, FlowLint compares
retained artifacts against its messages and nested tool calls. Missing items,
missing values, or changed values produce `ENCRYPTED_PRESERVATION` warnings.
An omitted input provides no evidence of loss. Threads are isolated; errors do
not erase history. Message snapshots replace included artifacts wholesale,
including withdrawing an omitted encrypted value. Snapshot deletion removes a
message and its attached tool calls. Reasoning/activity history follows the
protocol’s role-specific snapshot retention rules.

Only SHA-256 fingerprints of opaque strings are retained for comparison; values
and fingerprints are never emitted in diagnostics. No decoding, parsing, or
Unicode normalization is performed. The check establishes consistency of the
capture, not proof of actual storage or successful provider restoration.
Unknown string subtypes produce `ENCRYPTED_SUBTYPE` and are skipped when the rest
of the event is well formed. Non-string subtypes and malformed required fields
remain `SCHEMA_EVENT` errors.

Try `node dist/cli.js check examples/preservation.ndjson`. The paired
`examples/preservation-invalid.ndjson` demonstrates conflicting reopening
attributes and a lost artifact.

### Reasoning and steps

The checks follow the AG-UI 1.0
[reasoning](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/events/reasoning.mdx)
and [step](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/events/lifecycle.mdx#steps) rules.

Reasoning spans (`REASONING_START` / `REASONING_END`) and reasoning messages
(`REASONING_MESSAGE_START` / `CONTENT` / `END`) have separate ID namespaces.
A span and message can share an ID. Messages need no enclosing span; a span
can contain several messages and does not implicitly open or close them.
Duplicate openers, orphaned content/ends, and unclosed items at `RUN_FINISHED`
are errors. Closed IDs may reopen under the same owner.

`REASONING_MESSAGE_CHUNK` follows the same expansion and lane-boundary rules
as text/tool chunks, including FL010 for missing opening IDs and FL011 for
mixed explicit/chunk forms or ambiguous continuations. Named reasoning ownership
conflicts use `ATTRIBUTION`. Switching chunk family or ID closes the previous
chunk item in that lane. EOF does not synthesize closure. The previous
`COVERAGE_REASONING` warning is removed.

Steps are keyed by owner and `stepName`. They may overlap and do not contain
other events: finishing a step closes no explicit reasoning/message items.
Parent and child steps may share a name. A mismatched finish emits `ATTRIBUTION`
if that name is open for another owner, or `STEP_END` if no opener is known.
In an excerpt, another owner’s opener may be outside the capture; that case is
a `STEP_END` warning until an observed run/child start establishes the boundary.

Cancelled/interrupted run finishes still require all spans, messages, and steps
to be closed. `RUN_ERROR` abandons them, and the next run starts fresh. In partial
captures, unseen openers and EOF are warnings, but duplicate starts, repeated
ends, and items observed open at run finish remain errors. Child announcements
establish a known opening boundary for that owner's items.

Try `node dist/cli.js check examples/reasoning.ndjson` after building.

### Subagents

Subagent lifecycle and ownership checks follow the [AG-UI 1.0 subagent specification](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/events/subagents.mdx).

Invocations may overlap and nest. Announced IDs cannot be reused within a run,
and every announced invocation needs one terminal before `RUN_FINISHED`.
`RUN_ERROR` abandons all invocations. A suspended invocation may use the same ID
in a later run. A nested parent must have been announced in this run, but may
already have finished. A child terminal affects only its own chunk lane; explicit
items still require their own end events before the run finishes.

Attribution-only streams are valid: tags do not require lifecycle announcements.
If an announcement is present, it must precede attributed output. Output may
remain attributed to a finished invocation. Standalone state/custom/raw events
carry provenance without creating separate state documents.

Text, tool, reasoning, and activity continuations inherit omitted tags from their
openers and reject conflicting explicit tags. Tools inherit the known owner of
their parent message. Ownership persists across item closure; run input and
message snapshots seed historical ownership, with snapshots authoritative for
included IDs. Steps with the same name are tracked separately per owner, and a
step finish must carry that owner's tag explicitly. Replacing activity snapshots establish fresh ownership; `replace: false` preserves it.

In partial excerpts, missing subagent announcements and unseen nested parents
are warnings. Observed contradictions, duplicate terminals, self-parenting, and
unclosed announced invocations at `RUN_FINISHED` remain errors. An observed child
start establishes a boundary for that child's missing item openers. EOF remains
`FL012`, downgraded to a warning with `--allow-partial`.

## SSE captures

SSE input follows the [AG-UI SSE binding](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/basic/transports/http-sse.mdx).
Each blank-line-delimited block's joined `data` fields must contain exactly one
JSON event object. Multiline data fields join with a newline. Comments and other
SSE fields, including `event`, `id`, and `retry`, are ignored. LF, CRLF, CR, and a
leading BOM are accepted. Transport IDs neither deduplicate nor reorder events.

Auto detection recognizes a leading comment or `data`, `event`, `id`, or `retry`
field on the first nonempty line. Use `--input sse` for captures beginning with
unknown extension fields. JSON and NDJSON retain their existing detection rules.
Diagnostics map back to the JSON payload's original capture line and column,
including multiline syntax errors. HTTP headers and `[DONE]` markers are not
AG-UI event payloads and are not accepted as such.

A final data block without its blank-line delimiter is `PARSE_SSE_TRUNCATED`
(exit 2): it would not be dispatched by SSE. A properly framed stream that ends
without a run terminal remains `FL012` (exit 1, or a warning in partial mode).
`--allow-partial` does not repair malformed transport framing. Comments-only
captures contain no events and produce `PARSE_EMPTY`. The 10 MiB raw input limit
applies before decoding.

```sh
node dist/cli.js check examples/stream.sse
cat examples/stream.sse | node dist/cli.js check - --input sse --format json
```

## State patches

State uses [RFC 6902 JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) and the
[AG-UI snapshot/delta rules](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/basic/patterns/snapshots.mdx).
All six operations are supported: add, remove, replace, move, copy, and test.
Pointers decode `~0` and `~1`; array indices are validated, and `-` appends only
for add destinations. State may be any JSON value, including null or a scalar.
Object keys are treated as own JSON properties, including names such as
`__proto__`; inherited properties cannot be read or written.

A delta applies atomically to a copy of the current document. On failure,
`STATE_PATCH` identifies the operation number and reason without exposing paths
or values; the prior state remains intact. This is a warning, not a failed run.
Malformed operation shapes remain `SCHEMA_EVENT` errors from the pinned schema;
unknown operation kinds are also rejected by that schema rather than silently
skipped. Extension members on known operations are accepted.

Recorded `RUN_STARTED.input.state` establishes the baseline; a recorded input
that omits `state` defaults to `{}`. A snapshot replaces
it wholesale; successful deltas amend it. State is shared by parent and subagents
and retained separately per thread across runs, including errors. New recorded
input supersedes stored state. An input omitted from a capture may have contained
state, so FlowLint does not assume `{}`: `STATE_BASELINE` warns that the patch
cannot be checked until a snapshot or recorded input supplies a baseline. This
also applies in partial captures; an empty patch needs no baseline.

Validation retains at most 10 MiB of serialized state across threads and budgets
200 MiB of cumulative intermediate document sizes per trace. Expansion or work
limits produce `STATE_LIMIT` and mark the affected baseline unknown. Snapshots
can restore a baseline after an expansion limit; an exhausted work budget still
prevents further patch validation. These warnings identify skipped checks.
FlowLint does not emit reconstructed state. Activity content has a separate,
shared budget of the same size across all activities and threads.

Try `node dist/cli.js check examples/state.ndjson` after building.

## Activity patches

[Activity events](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/events/activity.mdx)
use the same atomic RFC 6902 engine as state. Content is tracked by thread and
message ID across runs. A snapshot replaces content and ownership by default,
including clearing an old owner when the new snapshot is untagged.
`replace: false` preserves an existing activity; a conflicting explicit owner
produces `ATTRIBUTION`. Unknown activity types and retyping are allowed.

A missing activity produces `ACTIVITY_BASELINE`, even for an empty patch.
Patch application failures produce `ACTIVITY_PATCH`; both are warnings and skip
the update. A successful patch whose final result is not an object produces
`ACTIVITY_CONTENT`, an error. The prior content is retained in each case.
Malformed patches remain schema errors. Resource exhaustion produces
`ACTIVITY_LIMIT` and marks the affected baseline unknown until a fresh snapshot.
Paths and content never appear in these diagnostics.

`MESSAGES_SNAPSHOT` seeds included activities. If it contains any activity,
omitted activities are removed; otherwise existing activities survive. An
included non-activity with the same ID replaces the activity. Partial captures
use the same patch rules, with missing baselines reported as warnings.

Try `npx flowlint check examples/activity.ndjson` from a checkout.

## Use in GitHub Actions

For traces stored in a FlowLint checkout, copy this to
`.github/workflows/lint-trace.yml`. Replace `TRACE_FILE` with your recorded trace.
The final step fails the job on a lint error or input failure; warnings pass.
This example builds from source.

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

In another project, run `npm install --save-dev @leracherry/flowlint` and
`npx flowlint check path/to/trace.ndjson`. The npm package, source repository, and GitHub release assets are public.
