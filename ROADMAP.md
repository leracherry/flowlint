# Implementation progress

This checklist follows the supplied FlowLint implementation plan. All work stays
in one TypeScript package, with a CLI and deterministic library API.

- [x] Milestone 0: repository foundation, strict TypeScript, build, lint, formatting,
      tests, CLI help/version, MIT license, contributor guide, Node 22/24 CI.
- [x] Milestone 1: NDJSON/JSON/stdin loading, per-event source locations, official
      AG-UI 1.0.2 runtime schema validation, safe parse/schema diagnostics, input
      limits, CLI exit codes and sample traces.
- [x] Milestone 2: explicit run/text/tool lifecycle rules FL001–FL009, run identity,
      interleaving, error/finish distinction, complete and partial capture modes,
      EOF FL012 checks, paired valid/invalid fixtures and regression tests.
- [x] Milestone 3: normalize text and tool chunks, FL010/FL011, lane transitions,
      implicit closure, conflicting repeats, and compatibility fixtures.
- [x] Milestone 4: developer experience and CI readiness, final reporter polish,
      one-file/glob policy, and a copy-pasteable GitHub Actions usage example.
- [x] Milestone 5: distribution and release.
  - [x] Package metadata, changelog, contributor feedback template, and release docs.
  - [x] Packed file-list verification and fresh-project CLI/API/type checks.
  - [x] GitHub release automation with a verified tarball and checksum.
  - [x] npm publishing workflow using the repository NPM_TOKEN secret.
  - [x] Confirm npm scope ownership and submit v0.1.0 successfully to npm.
  - [x] Verify public registry availability and a fresh npm registry installation.

v0.1.0 is available as a verified GitHub tarball and the public npm package
`@leracherry/flowlint`. A fresh registry installation, CLI run, and library import
passed on 2026-10-11. The source repository is now public. Token-based
publishing is configured; Trusted Publishing remains an optional migration.
See RELEASING.md.

## v0.2.0

- [x] Subagent lifecycle validation, nested/parallel invocations, attribution-only
      streams, inherited entity ownership, snapshot/input ownership, and partial
      capture regressions. Explicit item checks stay active in subagent runs.
- [x] Reasoning span/message and per-owner step lifecycle checks, reasoning
      chunk normalization, and partial-capture regressions.
- [x] SSE input with original source locations, transport truncation detection,
      and atomic state-patch validation with bounded resources.

- [x] Activity snapshot/delta validation, ownership replacement, history
      reconciliation, and bounded patch application across threads.

## Next release (unreleased)

- [x] Reopened message/tool attributes, including normalized chunks, historical
      input, snapshots, and per-thread continuity.
- [x] Encrypted reasoning target checks and preservation in later recorded input,
      with snapshot withdrawal, opaque fingerprints, and warning-only handling
      of missing targets and unknown string subtypes.

- [x] Pinned recorded producer corpus: 19 journeys / 918 events across Strands
      Python, Strands TypeScript, and LangGraph/DeepAgents, with provenance and
      exact diagnostic expectations. See test/fixtures/producers/README.md.

- [x] Compatibility policy for CLI/API/JSON, rule severity and acceptance changes,
      protocol/schema updates, runtime support, and release classification.

Remaining work toward 1.0:
fuzz/property testing, resource/performance validation, cross-platform installation
checks, and a release candidate. FlowLint validates captures; consumer storage,
provider restoration, metadata merging, and full protocol certification are not
part of its current guarantees.
