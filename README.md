# FlowLint

An offline linter for [AG-UI](https://docs.ag-ui.com/) event traces.
Check lifecycles, subagents, reasoning, and JSON patches from your terminal or TypeScript app.
No agent runtime or LLM calls required.

## Install

Requires **Node.js 22+**. Tested on Linux, macOS, and Windows.

```sh
npm install --save-dev @leracherry/flowlint
```

## Quick start

```sh
# Check an event trace
npx flowlint check trace.ndjson

# Check a raw SSE capture
npx flowlint check stream.sse

# Get JSON diagnostics
npx flowlint check trace.json --format json

# Read from stdin
cat trace.ndjson | npx flowlint check -

# Check an excerpt of a longer trace
npx flowlint check excerpt.ndjson --allow-partial
```

Accepts NDJSON, a JSON array of events, or SSE. Pass one file or stdin per invocation.

A diagnostic looks like this:

```text
2:1  error  FL002  TEXT_MESSAGE_CONTENT refers to unopened text message "m-2"
```

Exit codes: **0** passed · **1** lint errors · **2** invalid input or usage.
Warnings do not fail a check, making FlowLint easy to use in CI.

## What it checks

- Event shapes against the official AG-UI schemas.
- Missing, duplicate, or out-of-order run, message, and tool-call events.
- Text and tool chunks with missing fields or conflicting metadata.
- Unfinished runs and open items at the end of a capture.
- Subagent lifecycles, nested delegation, and consistent event ownership.
- Reasoning spans, reasoning message streams, and per-agent steps.
- State and activity patches against recorded baselines.
- Consistent attributes when messages and tools reopen.
- Encrypted artifact targets and preservation across recorded runs.

Interleaved messages and tool calls are supported. Use `--allow-partial` for
captures that may start or end mid-stream.

See the [reference](REFERENCE.md) for every rule and its limits. From 1.0 onward,
changes that make passing traces fail require a major release; see the
[compatibility policy](COMPATIBILITY.md).

## TypeScript API

```ts
import { readFileSync } from "node:fs";
import { lintEvents, parseTrace } from "@leracherry/flowlint";

const trace = readFileSync("trace.ndjson", "utf8");
const result = lintEvents(parseTrace(trace));

console.log(result.valid);
console.log(result.diagnostics);
```

## Contributing

```sh
pnpm install
pnpm check
```

Use Node.js 22+ and pnpm 10.17.1. Bug reports and small, redacted example traces
are welcome in [Issues](https://github.com/leracherry/flowlint/issues).
See the [contributing guide](CONTRIBUTING.md) to get started.

## Documentation

- [CLI, rules, and CI examples](REFERENCE.md)
- [Compatibility and versioning](COMPATIBILITY.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Release guide](RELEASING.md)

## License

[MIT](LICENSE)
