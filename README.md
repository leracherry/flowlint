# FlowLint

Offline linting for AG-UI agent event traces. A small TypeScript library and CLI
that catches stream lifecycle mistakes without starting an agent or calling an LLM.

**Status: initial implementation.** Runtime schema validation uses the official
`@ag-ui/core/schemas` entry point, pinned to AG-UI core 1.0.2. The initial sequence
rule is **FL002: text content references a message that is not open**.
This is a first working slice, not full protocol conformance or the completed v0.1
rule set. A successful check means only the documented checks passed.

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

- Official runtime validation for all event shapes in the pinned schema.
- FL002 for `TEXT_MESSAGE_CONTENT` after a missing start or observed end.
- Message IDs tracked independently; legal tool/text interleaving accepted.
- Run terminals reset message state; `RUN_ERROR` is not itself a lint failure.
- Partial mode downgrades missing openers before an observed run start to warnings.
- Text chunks trigger a coverage warning and suspend FL002 for that run because
  chunk expansion is pending.

Run identity, duplicate opens, unopened end events, tool lifecycle, EOF/truncation,
chunk normalization, reasoning, and subagent lanes are not yet sequence-checked.
Attributed subagent text events are excluded from FL002 pending lane support.
Do not use this initial slice as a conformance gate for those features.

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
