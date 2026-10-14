# Changelog

## Unreleased

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
