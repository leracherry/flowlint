# Changelog

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
See README for precise supported behavior. A clean result is not full protocol
conformance certification.

### Distribution

The GitHub Release contains an installable npm tarball and SHA-256 checksum.
npm accepted `@leracherry/flowlint@0.1.0`; initial registry availability is pending.
