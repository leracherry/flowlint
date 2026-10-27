# Contributing

Use Node.js 22+ and pnpm 10.17.1. Run `pnpm install`, then `pnpm check`.
Run `pnpm format` before committing. Tests include bundled CLI integration checks.

Add regression cases for both broken traces and legal streams before expanding
rule coverage. Reuse the official AG-UI schemas, preserve source locations, and
keep event content out of diagnostics. Arrival order is authoritative.

Classify behavior changes using [COMPATIBILITY.md](COMPATIBILITY.md). A new default
error or stricter acceptance requires a breaking release, even for a bug fix.
Do not update recorded-trace expectations merely to make new failures pass.

Add each new rule to REFERENCE.md with its ID, severity, and coverage limits.
Include valid and invalid examples, plus partial-capture regressions where relevant.
See [ROADMAP.md](ROADMAP.md) for completed phases and remaining gaps.

Run `pnpm verify:package` to check the distributable in a fresh consumer project.
See [RELEASING.md](RELEASING.md) for GitHub and npm release instructions.
Include an entry in CHANGELOG.md for each release.

The [recorded producer corpus](test/fixtures/producers/README.md) runs offline in
normal CI. Keep source provenance and checksums when adding recordings. Review
findings against the protocol; do not assume every upstream recording is valid.

Run `pnpm stress` for bounded subprocess checks of NDJSON, JSON, and SSE (25,002
records each, a 256 MiB V8 old-space ceiling, and 30-second process timeouts).
The output reports elapsed time and end-of-run heap usage, not a performance SLA
or peak memory. Seeded randomized tests run within `pnpm check`; failures are
reproducible. CI runs checks, stress cases, and package installation on Node 22/24
across Linux, macOS, and Windows. Keep `.gitattributes` line-ending rules so pinned
producer fixture hashes remain identical across checkouts.

Incremental validation also runs NDJSON/SSE stress workers that generate events
as they go, covering retained history, patches, and interleaved agents. These
report OS peak RSS as well as end-of-run heap. When changing session or parser
behavior, preserve batch results, source coordinates, and byte-partition
equivalence; see [incremental validation](docs/incremental.md).

When changing HTML reports, run `pnpm exec playwright install chromium` and
`pnpm test:html` to check the real browser behavior, restrictive policy, keyboard
navigation, offline use, and large-trace rendering. Unit tests also verify
payload omission and artifact limits. The separate HTML CI job runs Chromium.

Reproducer changes must preserve the selected original event, reason, severity,
related evidence, and dependency context. Verify retained values and serialized
output against the original mapping; do not accept a different error with the same
rule ID. Check budget/cancellation outcomes and keep unsupported cases explicit.

Comparison changes need both equal and changed regressions, including ownership,
arrival order, and uncertainty. Keep unknown/opaque cases incomparable rather than
broadening normalization. Test the packaged CLI and public types; preserve the
versioned policy contract in [comparison](docs/comparison.md). Derived producer
recordings must remain clearly identified and leave original fixture bytes intact.

Comparison stress workers cover concurrent entity mapping, many thread outcomes,
and rechunked content with the same process budget as the batch stress checks.

Run `pnpm demo` to verify the recorded DeepAgents evidence workflow in a new output
directory. CI runs it on all supported platforms. Maintenance checks have offline
mocked-network regressions in `test/maintenance.test.js`; use the separate
[producer workflow](docs/maintenance.md) for live drift checks. Never import or
execute downloaded producer code. Preserve the pinned corpus until changes and
licensing have been reviewed. Adoption claims need the evidence described in
[the ledger](docs/adoption.md).
