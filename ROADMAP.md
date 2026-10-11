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
passed on 2026-10-11. The source repository remains private. Token-based
publishing is configured; Trusted Publishing remains an optional migration.
See RELEASING.md.
The current rules deliberately do not validate reasoning/step/subagent lifecycles,
SSE transport framing, state patch application, or reopened item attributes.
Reasoning and subagent coverage warnings identify skipped checks until supported.
Text/tool chunk assembly supports resolvable attribution lanes; full explicit
subagent item lifecycle checks remain suspended and are not claimed as complete.
EOF checks refer to capture truncation, not tool execution or result completion.
