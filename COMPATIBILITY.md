# Compatibility policy

FlowLint treats its lint decisions as part of its public interface. This policy
applies prospectively to releases made after its adoption. The published package
version identifies the contract; `main` contains unreleased work.

## Release guarantees

Starting with **1.0.0**, releases use the following rules:

| Change                                                                                                          | Required release |
| --------------------------------------------------------------------------------------------------------------- | ---------------- |
| Remove or rename a public export, command, option, JSON field, or diagnostic ID                                 | Major            |
| Change an existing public type incompatibly, an exit-code meaning, or a default incompatibly                    | Major            |
| Make a previously passing trace fail under the same options and supported environment                           | Major            |
| Add a default error rule, broaden an error rule, or promote a warning to an error                               | Major            |
| Narrow supported input, lower a documented resource limit, or drop a supported Node version                     | Major            |
| Add warnings, broaden warning coverage, or add an optional feature without changing existing pass/fail behavior | Minor            |
| Add an optional API option, export, command, or JSON field compatibly                                           | Minor            |
| Remove a false positive, fix a crash on supported input, or correct a source location                           | Patch            |
| Improve documentation, diagnostic wording, terminal layout, or performance without changing the contract        | Patch            |

The most restrictive applicable row wins. A stricter error check requires a major
release even when it fixes a missed protocol violation. Security and dependency
updates follow the same compatibility rules; urgency does not silently waive them.
Removing an erroneous finding is a patch; intentional rule removal or a policy
change that lowers severity is a major release. Consumers must tolerate additional
warnings and optional JSON fields in minor releases. If a project treats warnings
as failures, it should pin exact versions and review upgrades.

**1.0.0 establishes the stable baseline.** The transition from 0.2.0 includes
stricter checks and limits; see the [migration notes](CHANGELOG.md#upgrading-from-020).
The pre-1.0 rule—breaking changes required a new 0.x minor version—does not permit
breaking changes in stable minor releases. Future breaking changes require 2.0.0
or a subsequent major version.

Prereleases such as `1.0.0-rc.1` are evaluation builds and can change before stable
release. Changelogs must still identify compatibility changes. Published versions,
tags, and release assets are immutable: corrections ship as new versions.

## Public CLI contract

The `flowlint` executable and documented commands/options in
[REFERENCE.md](REFERENCE.md) are public. Currently this includes:

- `check <file>` with one path or `-` for stdin.
- `--input auto|ndjson|json|sse`, defaulting to `auto`.
- `--format pretty|json`, defaulting to `pretty`.
- `--allow-partial`, with complete-capture checking as the default.
- `--help` and `--version`.
- `report <file> --output <file>` with `--input`, `--allow-partial`, and
  `--max-events` (default 2000; 1–10000). Existing output files are not overwritten.
- `suite <patterns...>` with `--input`, `--allow-partial`, and
  `--format pretty|json|github|markdown`; see the separate versioned
  [suite JSON contract](REFERENCE.md#aggregate-json-contract).

Exit **0** means no error diagnostics; warnings may exist. Exit **1** means schema
or lint errors. Exit **2** means input, parsing, or usage failure. Help/version exit
0; invoking the executable without a command exits 2. Reports go to stdout.
The suite command uses its documented aggregate envelope.
`check --format json` produces one JSON result, including reported input/usage
failures; help/version remain text. Automation should parse JSON and exit status,
not pretty output, help prose, or diagnostic message wording.

Complete/partial capture defaults, accepted encodings, and documented limits are
part of the contract. A fix that newly rejects an accepted capture, including a
transport parsing correction, uses the breaking-change version rule above.

## Library and diagnostics

The public library surface is the package-root ESM exports and their shipped
TypeScript declarations: `lintEvents`, `parseTrace`, `formatJson`, `formatPretty`,
`TraceInputError`, `MAX_INPUT_BYTES`, `SUPPORTED_RULES`, `RULES`, `createHttpCapture`, `createLintSession`, `parseTraceStream`,
`lintTraceStream`, `generateHtmlReport`, and the exported types
`Diagnostic`, `DiagnosticLocation`, `InputFormat`, `LintOptions`, `LintResult`, `SourceEvent`, `CaptureManifest`, `HttpCaptureOptions`, `LintSession`, `LintSessionOptions`, and `HtmlReportOptions`.
Deep imports, source modules, internal classes, build filenames, and source maps
are not supported APIs. CommonJS and browser runtimes are not currently promised.

`parseTrace` throws `TraceInputError` for reported input failures. Its `code`,
`line`, and `column` are machine-readable; its message wording and stack are not
stable. `lintEvents` returns a result for schema/lint findings; an unsupported
protocol option throws. Existing valid call signatures and return field types
must remain compatible within a stable major version.

The JSON report has the same public shape as `LintResult`:

- `valid`: true when no error diagnostic exists.
- `protocol`: the selected protocol identifier, currently `ag-ui/1.0`.
- `checkedEvents`: number of supplied source records, not normalized synthetic
  events; CLI failures before checking use 0.
- `supportedRules`: the implemented lint-rule IDs; not an exhaustive list of
  input, schema, or diagnostic-limit codes. Treat it as a set, not a fixed tuple.
- `diagnostics`: records with `ruleId`, `severity`, and human-readable `message`,
  plus optional `eventIndex`, `line`, and `column`. Reopening findings also include
  optional `context` (entity kind, ID, conflicting field names) and `related` source
  locations with explanatory messages. Consumers must tolerate additional evidence
  and must not parse explanatory prose as a stable identifier.

Event indices are zero-based; lines/columns are one-based. Locations may be absent
where no event location exists. Diagnostic ordering follows source event index,
then rule ID; findings without an event index follow event findings. Fixes may
correct locations and remove false findings. JSON whitespace, object-key order,
pretty formatting, and exact message text are not compatibility guarantees.

Diagnostic IDs keep their meaning and are never reassigned to unrelated checks.
Renaming or removing a code is breaking. New codes follow the severity rules above.
Consumers must handle unfamiliar codes and optional fields rather than assume an
exhaustive list. A clean result establishes only the documented coverage, not full
protocol conformance or proof of a consumer’s internal behavior.

## Protocol and runtime support

FlowLint currently checks **AG-UI 1.0** using the exactly pinned `@ag-ui/core` schema
version in `package.json`. Protocol versions and package versions are separate.
An upstream schema upgrade is reviewed for changed accepted inputs and diagnostics;
an unchanged protocol label does not make that upgrade automatically compatible.
Future protocol support must be opt-in before it can replace an existing default.

The package currently declares **Node.js >=22** and CI verifies Node **22 and 24**
on Linux, macOS, and Windows, including fresh package installation. Other matching Node versions are accepted by the package engine range;
this is not a claim that every version or operating system has been tested.
Dropping a declared supported Node version is breaking. Packaged TypeScript
consumers are currently verified with TypeScript 5.9; introducing declarations
that require a newer compiler is breaking for that tested baseline. This CI matrix covers those runner environments; it is not certification of
every operating-system version or architecture.

## Deprecation and maintenance

Before a planned removal in a stable major version, document the replacement and
migration path in at least one preceding minor release where practical. Removal
still requires a major release; an urgent breaking fix may skip the advance notice
but must include migration guidance. Pre-1.0 changes use the 0.x rules above.

Maintenance focuses on the latest release. Backports and long-term support for
older lines are not promised. Exact version pins and lockfiles provide reproducible
checks; review the changelog before upgrading.

Every release must classify its compatibility impact, describe changes to rule
coverage/severity and supported environments, and pass the release checks in
[RELEASING.md](RELEASING.md). A breaking release needs a concrete before/after
example and migration guidance. Regression expectations must be reviewed against
the protocol rather than silently updated to accept new failures.

## Capture artifacts

`createHttpCapture` is an additive Node API. Its options and version-1 manifest
are documented in the [capture guide](https://github.com/leracherry/flowlint/blob/main/docs/capture.md).
The manifest SHA-256 describes stored response-body bytes, not complete network
traffic. Treat additional optional fields as compatible and do not assume a
complete capture is protocol-valid. Skipped captures do not have persisted files.

## Incremental validation

The additive session and byte-stream APIs are described in the
[incremental guide](https://github.com/leracherry/flowlint/blob/main/docs/incremental.md).
Snapshots are provisional. Only explicit finalization after a clean source EOF
adds capture-boundary checks. New streaming/session limits do not change existing
batch acceptance. Streaming errors are reported on arrival, so inputs with several
different errors may have a different first failure than whole-input parsing.

## HTML artifacts

`generateHtmlReport` and the report command are additive interfaces documented in
the [HTML guide](https://github.com/leracherry/flowlint/blob/main/docs/html-reports.md).
The CLI preserves check exit meanings: lint errors can produce a report with exit
1, while input/output failures use 2. Payload fields are omitted; metadata and
diagnostic messages remain visible. HTML styling and DOM structure are not stable
automation interfaces. Use JSON diagnostics for machine-readable integrations.
