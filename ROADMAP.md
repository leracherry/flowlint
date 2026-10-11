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
- [ ] Milestone 4: developer experience and CI readiness, final reporter polish,
      one-file/glob policy, and a copy-pasteable GitHub Actions usage example.
- [ ] Milestone 5: OSS release, package name verification, npm publishing setup,
      tagged release, and changelog.

GitHub release automation is already configured; no release has been published.
The current rules deliberately do not validate reasoning/step/subagent lifecycles,
SSE transport framing, state patch application, or reopened item attributes.
Reasoning and subagent coverage warnings identify skipped checks until supported.
Text/tool chunk assembly supports resolvable attribution lanes; full explicit
subagent item lifecycle checks remain suspended and are not claimed as complete.
EOF checks refer to capture truncation, not tool execution or result completion.
