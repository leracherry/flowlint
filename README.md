# FlowLint

An offline linter for [AG-UI](https://docs.ag-ui.com/) event traces.
Catch broken run, message, and tool-call lifecycles from your terminal or TypeScript app.
No agent runtime or LLM calls required.

## Install

Requires **Node.js 22+**.

```sh
npm install --save-dev @leracherry/flowlint
```

## Quick start

```sh
# Check an event trace
npx flowlint check trace.ndjson

# Get JSON diagnostics
npx flowlint check trace.json --format json

# Read from stdin
cat trace.ndjson | npx flowlint check -

# Check an excerpt of a longer trace
npx flowlint check excerpt.ndjson --allow-partial
```

Accepts NDJSON or a JSON array of events. Pass one file or stdin per invocation.

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

Interleaved messages and tool calls are supported. Use `--allow-partial` for
captures that may start or end mid-stream.

Coverage is still growing: reasoning, step, and full subagent lifecycles, state
patches, and SSE input are not supported. Reasoning and subagent events emit
coverage warnings; subagent runs skip explicit message/tool lifecycle checks.
See the [reference](REFERENCE.md) for every rule and its limits.

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
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Release guide](RELEASING.md)

## License

[MIT](LICENSE)
