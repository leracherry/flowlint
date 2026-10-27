# Changelog

## 1.1.0 - 2026-10-26

An additive release for turning recorded AG-UI interactions into repeatable
regression checks. Install with `npm install --save-dev --save-exact @leracherry/flowlint@1.1.0`.

### Added

- Source evidence for reopening findings, with related locations and structured
  context. Public `RULES` metadata describes implemented checks.
- `suite` for deterministic corpus checks, aggregate JSON, GitHub annotations,
  and Markdown CI summaries.
- `createHttpCapture` for bounded Node HttpAgent SSE recording and provenance.
- Incremental lint sessions and NDJSON/SSE byte-stream APIs with source locations,
  explicit finalization, cancellation, and resource budgets.
- `report` and `generateHtmlReport` for standalone offline HTML with evidence
  navigation, filtering, bounded timelines, and payload omission.
- `minimize`, `getReproFindings`, and `minimizeTrace` for verified event-deletion
  reproducers with finding identity, retained context, source maps, and budgets.
- `compare`, `compareTraces`, and `formatComparison` with the versioned
  `adapter-upgrade/v1` policy, scoped IDs, adjacent chunk normalization, ownership
  and shared-state checks, bounded diffs, and explicit incomparable results.
- Repository demo, recorded DeepAgents case study, adoption ledger, issue forms,
  and a read-only weekly producer compatibility workflow. These maintenance tools
  and the demo require a repository checkout; the runtime APIs ship in npm.

### Compatibility and upgrading

This is a minor release: existing `check`, `lintEvents`, and `parseTrace` acceptance,
diagnostic identifiers/severities, supported encodings, resource limits, and exit
meanings are preserved. AG-UI core remains pinned to 1.0.2; Node 22+ remains
required, with Node 22/24 verified across Linux, macOS, and Windows. TypeScript
consumers are checked with 5.9. No migration is required for existing checks.

JSON consumers must tolerate the new optional diagnostic `related` and `context`
fields. Existing runtime exports remain available. The new session limit applies
to incremental sessions and does not lower the existing batch limit.

New commands have distinct outcomes: `compare` exits 0 for equal, 1 for changed,
2 for input failure, and 3 for incomparable. A successful `minimize` exits 0 for a
verified artifact even when the reproduced trace intentionally has lint findings.
See each command's guide before adding it to a CI gate.

The release is supported by regression, package, browser, stress, and recorded
producer checks. The 19-journey corpus retains its four expected DeepAgents
reopening findings. Independent confirmation, external CI retention, and a real
adapter-upgrade trial remain open; this release does not claim those outcomes.

## 1.0.0 — 2026-10-17

First stable release. FlowLint’s CLI, TypeScript API, JSON diagnostics, and lint
acceptance behavior now follow [COMPATIBILITY.md](COMPATIBILITY.md). Future
changes that make a passing trace fail require a major release.

### Added

- Reopened message/tool attribute checks across explicit streams, chunks,
  recorded history, and runs on the same thread.
- Encrypted artifact target and preservation checks, respecting snapshot
  replacement and withdrawal. Values remain opaque; only fingerprints are retained.
- Warning-only handling of well-formed encrypted events with unknown string subtypes.
- A reproducible corpus of 19 upstream producer journeys (918 events), including
  four expected DeepAgents reopening findings in two resume journeys.
- Seeded randomized parser, patch, and chunk tests; bounded stress checks with
  25,002 events per format; Node 22/24 CI and package installation checks on
  Linux, macOS, and Windows.

### Fixed

- Deeply nested JSON now produces a structured input error instead of a stack crash.
- Cyclic, sparse, oversized, and excessively shared direct API inputs are bounded
  before schema validation or serialization.
- Failed patches consume the work budget for copying their baseline; generated
  patch structures are bounded before recursive processing.

### Upgrading from 0.2.0

Install `@leracherry/flowlint@1.0.0`. Existing command names, options, API exports,
JSON fields, and exit-code meanings are unchanged. Review these stricter checks
before updating a CI lockfile:

- Reopening a tool with a different name or parent, or a message with a different
  role/name, now reports `ITEM_REOPEN` and exits 1. For example, a tool first opened
  with `parentMessageId: "m"` must repeat that parent when reopened; omitting it
  previously passed. Preserve the original attributes or use a new identifier.
- A later recorded input that loses an encrypted artifact now warns with
  `ENCRYPTED_PRESERVATION`. Return the unchanged artifact, or withdraw it through
  an authoritative snapshot. Warnings continue to exit 0 when no errors exist.
- JSON nesting over 256 containers and captures over 100,000 physical lines now
  fail with `PARSE_DEPTH` / `PARSE_LINES` (exit 2). Per-event traversal is limited
  to 100,000 values and 10 MiB of string values/keys; violations and cycles produce
  `LIMIT_EVENT` (exit 1). Simplify oversized records or split captures at valid
  boundaries. `--allow-partial` does not bypass resource limits.
- The 200 MiB patch-work budget now counts baseline copies, including failed
  attempts. Exhaustion warns and marks the baseline unverified. Fix repeated
  failing patches and use a fresh snapshot to resynchronize after expansion limits.

These changes establish the 1.0 baseline; the planned 0.3.0 release was superseded
by this stable release. A clean result covers the checks documented in
[REFERENCE.md](REFERENCE.md), not full protocol conformance or internal consumer
storage. The producer corpus uses controlled integration recordings, not production
traffic, and its coverage limits remain documented.

## 0.2.0 — 2026-10-15

- Validate activity patches, snapshot replacement and ownership, object-only
  results, message-history reconciliation, and per-thread persistence.
- Bound activity validation resources and keep content out of diagnostics.
- Enable npm provenance for the now-public repository and publish version-specific
  GitHub release notes.
- Refresh README and reference documentation for the expanded coverage.

- Parse SSE captures automatically or with `--input sse`, preserving source
  locations across multiline data and detecting unfinished framing.
- Validate RFC 6902 state patches atomically against recorded baselines,
  warning on application failures and unknown baselines without leaking state.
- Add state/SSE examples and bounded state validation across threads.

- Validate reasoning spans, explicit reasoning messages, and per-owner step
  lifecycles, including run closure, error abandonment, and partial captures.
- Normalize reasoning chunks with FL010/FL011 checks and remove the reasoning
  coverage warning. Add a reasoning/step trace example.

- Validate subagent invocation starts, terminals, nested parents, and run closure.
- Keep explicit message/tool checks active alongside parallel and nested subagents.
- Check inherited ownership across text, tools, reasoning, activity, and steps,
  including historical ownership from run input and message snapshots.
- Accept attribution-only producers, trailing attributed output, and suspended
  invocations resumed in later runs; retain partial-capture severity handling.
- Preserve chunk state when rejecting invalid run boundaries.

## 0.1.0 — 2026-10-11

Initial release of FlowLint, an offline CLI and TypeScript library for AG-UI traces.

- Read NDJSON, JSON arrays, and stdin with source-aware diagnostics.
- Validate event structures with official AG-UI core 1.0.2 schemas.
- Check explicit run, text, and tool lifecycles with FL001–FL009.
- Normalize text/tool chunks and detect missing openers, contradictory repeats,
  mixed forms, and ambiguous lanes with FL010/FL011.
- Distinguish complete captures from excerpts and report truncation with FL012.
- Provide readable terminal reports, JSON output, and stable exit codes.
- Test Node 22/24 and verify the packed CLI, JavaScript API, and TypeScript types.

### Coverage limits

Reasoning chunks and full subagent lifecycle checks remain incomplete and produce
coverage warnings where relevant. SSE parsing, state patch application, step
lifecycles, and reopened-item attribute checks are outside this release's scope.
See REFERENCE.md for precise supported behavior. A clean result is not full protocol
conformance certification.

### Distribution

The GitHub Release contains an installable npm tarball and SHA-256 checksum.
Published on npm as `@leracherry/flowlint@0.1.0`; fresh installation verified.
