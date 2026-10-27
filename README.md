# FlowLint

Find broken AG-UI event lifecycles in a saved trace before they become a UI or
adapter regression. FlowLint checks recorded events offline and points findings
to their source locations. No agent runtime or model calls are required.

## Check your first trace

Requires Node.js 22+. Tested on Linux, macOS, and Windows.

```sh
npm install --save-dev --save-exact @leracherry/flowlint@1.1.0
npx flowlint check trace.ndjson
```

Accepts NDJSON, JSON arrays, or raw SSE. Use `--format json` for CI, `-` for stdin,
and `--allow-partial` for a known excerpt.

```text
2:1  error  FL002  TEXT_MESSAGE_CONTENT refers to unopened text message "m-2"
```

Exit **0** means no lint errors, **1** means findings, and **2** means invalid input
or usage. Warnings do not fail the check. A passing recording does not certify
application behavior or event families absent from that recording.

## See a finding explained

The [recorded DeepAgents case study](https://github.com/leracherry/flowlint/blob/main/docs/case-study-deepagents.md)
connects two reopened tool calls to the snapshot that established their parent.
The [90-second walkthrough](https://github.com/leracherry/flowlint/blob/main/docs/demo.md)
shows diagnosis, evidence, a reduced reproducer, and a regression check:

```sh
git clone --branch v1.1.0 https://github.com/leracherry/flowlint.git
cd flowlint
pnpm install --frozen-lockfile
pnpm demo
```

Use pnpm 10.17.1. Open `demo-output/report.html` and follow the evidence links.
The demo uses a pinned public recording and clearly labeled derived copies. It is
verified in CI; it does not claim an upstream fix or independent adoption.

## From a trace to a regression check

**1.1.0** includes the checker, batch TypeScript API, and these opt-in workflows:

| Task                                                   | Guide                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Capture an HttpAgent response with provenance          | [Capture](https://github.com/leracherry/flowlint/blob/main/docs/capture.md)                    |
| Check a saved corpus and annotate CI                   | [Suites](https://github.com/leracherry/flowlint/blob/main/REFERENCE.md#trace-suites)           |
| Validate events as they arrive                         | [Incremental validation](https://github.com/leracherry/flowlint/blob/main/docs/incremental.md) |
| Inspect findings and establishing events locally       | [HTML reports](https://github.com/leracherry/flowlint/blob/main/docs/html-reports.md)          |
| Reduce a selected failure while retaining its evidence | [Reproducers](https://github.com/leracherry/flowlint/blob/main/docs/reproducers.md)            |
| Compare adapter recordings with explicit uncertainty   | [Comparison](https://github.com/leracherry/flowlint/blob/main/docs/comparison.md)              |

These commands have their own documented exit meanings and coverage limits.
Install an exact version and commit your lockfile for reproducible CI. The demo
and maintenance scripts require a repository checkout. See [first integration and adoption evidence](https://github.com/leracherry/flowlint/blob/main/docs/adoption.md).

## Coverage

Checks include run/text/tool lifecycles, chunks, subagent ownership, reasoning,
steps, state/activity patches, reopening attributes, and encrypted-artifact
preservation. The official AG-UI schema is exactly pinned.

The recorded corpus contains 19 journeys and 918 events. Two DeepAgents journeys
have four expected reopening findings. Several event families have only authored
regression coverage. See the [coverage matrix](https://github.com/leracherry/flowlint/blob/main/docs/coverage.md)
and [rule reference](REFERENCE.md) before using a result as a gate.

## TypeScript

```ts
import { readFileSync } from "node:fs";
import { lintEvents, parseTrace } from "@leracherry/flowlint";

const result = lintEvents(parseTrace(readFileSync("trace.ndjson", "utf8")));
console.log(result.valid, result.diagnostics);
```

## Contribute

Run `pnpm install --frozen-lockfile` and `pnpm check`. Report a questionable finding,
missing coverage, or integration problem through [Issues](https://github.com/leracherry/flowlint/issues/new/choose).
Use a reviewed trace that preserves the relevant ID relationships.

[Contributing](CONTRIBUTING.md) · [Maintenance](https://github.com/leracherry/flowlint/blob/main/docs/maintenance.md) ·
[Compatibility](COMPATIBILITY.md) · [Roadmap](ROADMAP.md) ·
[Changelog](CHANGELOG.md) · [Releasing](RELEASING.md)

[MIT](LICENSE)
