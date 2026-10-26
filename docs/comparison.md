# Compare recorded adapter behavior

Available on main, not in the published 1.0.0 package. Compare recordings of the
same controlled interaction before and after an adapter change. Run validation on
both captures first, then review comparison details against their source events.
This does not establish that a model, application, or unrecorded behavior is equal.

```sh
pnpm build
node dist/cli.js compare before.ndjson after.sse --policy adapter-upgrade/v1
node dist/cli.js compare before.ndjson after.ndjson --format json --max-differences 100
```

Runnable fixtures demonstrate all three outcomes:

```sh
node dist/cli.js compare examples/compare-before.ndjson examples/compare-rechunked.ndjson
# equal, exit 0
node dist/cli.js compare examples/compare-before.ndjson examples/compare-changed.ndjson
# changed, exit 1
node dist/cli.js compare examples/compare-before.ndjson examples/compare-incomparable.ndjson
# incomparable concurrent message identities, exit 3
```

Each input accepts NDJSON, a JSON array, or SSE with automatic detection. One input
may be `-` for stdin. Both inputs must fit the existing parser limits: 10 MiB,
100,000 records, and the per-event structural limits. Direct API inputs must be
JSON-compatible and have unique nonnegative event indices and positive source
coordinates. Values such as undefined, cyclic objects, and sparse arrays are
rejected rather than silently changed during serialization.

## Result and exit codes

| Status        | Exit | Meaning                                                                          |
| ------------- | ---: | -------------------------------------------------------------------------------- |
| equal         |    0 | Valid traces have matching projections under this policy.                        |
| changed       |    1 | Supported recorded observations differ. Protocol errors are reported separately. |
| input failure |    2 | Input, resource, or usage error; no comparison result.                           |
| incomparable  |    3 | Coverage or correspondence is uncertain; review the reasons.                     |

An incomparable result can still contain differences. Never treat exit 3 as a
passing regression check. Identical protocol-invalid traces are incomparable,
not equal. A supported difference, such as a missing terminal event, can be
reported as changed alongside the original lint error. `--allow-partial` retains
capture-boundary uncertainty; it does not authorize claiming equivalence.

## Policy: adapter-upgrade/v1

The policy is intentionally narrow and versioned separately from the package.
Changing equivalence rules requires a new policy name.

- Ignore only root event `timestamp`. Nested timestamps and arbitrary metadata
  remain literal. Object key order is irrelevant; array and event order matter.
- Map known thread identifiers globally, run/message/tool/interrupt identifiers
  within a thread, and subagent/reasoning-span identifiers within a run. Aliases
  follow first encounter, with source locations and original identifier labels.
  Recorded input, message history, tool results, parent references, and interrupt
  resume references use the corresponding known namespaces.
- Do not rewrite identifiers inside arbitrary RAW/custom data, tool arguments,
  state, or other opaque application fields. These are meaningful literal data.
- Expand schema-valid shorthand chunks using the same normalizer as validation.
  Merge only adjacent text/reasoning content or tool argument fragments whose
  remaining fields match. Empty fragments without additional metadata are ignored.
  Other events and different metadata prevent merging.
- Preserve starts, ends, run outcomes, roles, tool names, parent relationships,
  subagent ownership, state events, and observable order. An omitted ownership tag
  inherits established ownership; an explicit different tag remains different.
- Include final shared-state status and a SHA-256 of key-sorted JSON for each
  observed thread. Snapshot and patch validation uses the existing state tracker.
  Equal final state does not erase differences in intermediate events.

This is an ordered observation comparison, not a general semantic diff or a graph
isomorphism solver. It does not move independent events, compare parsed tool
argument objects, normalize application data, or discard intermediate snapshots.
An insertion can shift subsequent ordinal differences. Review the source events;
counts are differing canonical positions plus differing final state outcomes, not
the minimum number of edits. Chunk-generated events retain their source record;
merged content points to its first fragment.

## Uncertainty

Reasons are stable descriptive codes with a side and, where available, a source:

| Code                 | Why comparison is incomplete                                                |
| -------------------- | --------------------------------------------------------------------------- |
| input-coverage       | Schema validation or a resource limit prevented full projection.            |
| partial-boundary     | Missing run boundaries leave capture coverage uncertain.                    |
| invalid-equivalence  | Matching projections still have protocol errors.                            |
| ambiguous-entities   | Concurrent entities have indistinguishable opening attributes.              |
| history-scope        | Historical subagent ownership across runs lacks a unique invocation scope.  |
| encrypted-history    | Encrypted values cannot establish plaintext equivalence.                    |
| unknown-state        | A state/activity baseline, patch, content, or budget could not be verified. |
| unsupported-activity | Activity delta outcome comparison is not implemented.                       |
| chunk-normalization  | Chunk expansion is invalid or has protocol uncertainty.                     |
| chunk-extensions     | Expansion would discard unknown chunk extension fields.                     |

Issues are deduplicated by code per side, retaining the first available context.
Concurrent ambiguity is conservative even when both recordings have identical
bytes. Activity snapshots are compared literally; activity delta traces remain
incomparable. Unsupported cases are not silently skipped into an equal result.

## TypeScript

```ts
import {
  compareTraces,
  formatComparison,
  parseTrace,
} from "@leracherry/flowlint";

const result = compareTraces(parseTrace(beforeText), parseTrace(afterText), {
  policy: "adapter-upgrade/v1",
  maxDifferences: 50,
});
console.log(formatComparison(result));
if (result.status !== "equal") {
  // Inspect result.protocol, result.issues, and source-backed differences.
}
```

The version-1 JSON result includes the policy/status, both original lint results,
coverage issues, source coordinates and differing field names, entity mappings,
state digests/status, and input/canonical event counts. `maxDifferences` defaults to
50 and accepts 1–1000. Total difference counts remain available when details are
omitted. Mapping output retains the first 2,000 entries per side; long labels and
field names are shortened, with omitted counts/flags. Full internal identities
are used for comparison. Each difference retains at most 20 field names.

Payload values are omitted from differences. This is not anonymization: original
identifier mappings, diagnostic messages, field names, coordinates, and state
hashes remain visible. Treat reports as potentially sensitive. Hashes do not
protect low-entropy state from guessing. Original captures require separate
review before sharing.

## Evidence and remaining validation

Unit tests cover supported normalization, relationships, ownership changes,
ordering, terminal loss, patches, opaque/partial input, ambiguity, and bounds.
The 19 pinned producer recordings are checked for self-comparison consistency;
a derived Strands TypeScript recording tests ID renaming and rechunking without
editing the fixture. These controlled transformations are not real upgrade
captures. An independent maintainer trial on a real adapter upgrade remains open.
