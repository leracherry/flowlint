# Faithful reproducer generation

The minimizer is unreleased on main. Build a checkout to try it; the published
1.0.0 package does not include it.

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js minimize trace.ndjson --list
node dist/cli.js minimize trace.ndjson --finding <id-from-list> --output ./repro-bundle
node dist/cli.js check ./repro-bundle/repro.ndjson
```

Replace `<id-from-list>` with the complete `repro-v1:` identifier printed by the
first command. Use the same source events and capture options for both commands.
`--list` prints all findings and says whether their dependency model is supported.
A clean trace prints “No findings”. No issue or message is posted automatically.

## What the bundle contains

The output directory must be new and its parent must exist. Existing directories
and artifacts are not overwritten. A successful write creates:

- `repro.ndjson`: retained events in original order, with JSON field values intact.
- `manifest.json`: tool/protocol and fingerprint versions, selected finding,
  capture options, serialized input/output hashes, transformations, source mapping,
  pinned event indices, verified lint result, stop reason, and reduction statistics.
- `issue.md`: a short, reviewable issue attachment describing how to check the
  reproducer and where to find its evidence. It is not posted for you.

The manifest omits the API result's `ndjson` field to avoid duplicating payloads.
Its `mapping` maps each output event index to the original event index, line, and
column. `validation` uses the output NDJSON coordinates; `finding.diagnostic` uses
the original input coordinates. Source indices need not be contiguous, but must
be unique nonnegative safe integers. Lines/columns must be positive safe integers.

`inputSha256` hashes JSON.stringify NDJSON serialization of the original events, not
original SSE framing, whitespace, or network bytes. `outputSha256` hashes the exact
written NDJSON bytes. Object property order is retained and contributes to these
hashes; this is not a standard JSON canonicalization algorithm. Transformations record deletion when it occurred and NDJSON
serialization. This does not replace raw capture provenance. For an unreleased
build, also record the source commit when sharing the bundle.

## Failure fidelity

Reduction selects a specific finding, not merely a rule ID. Version-1 finding IDs
bind the serialized input hash, partial-capture option, diagnostic position, rule,
severity, message, entity context, original primary event index, and related-event
identities. Encoding-dependent line/column values are excluded from the identity.
Changing unrelated input events can invalidate the ID; list findings again rather
than using a stale ID. Fingerprints can change when future versions change wording
or validation behavior. They are not cross-version deduplication guarantees.

Each candidate is checked with original source indices. It must retain the selected
finding and cannot introduce new diagnostics or increase the multiplicity of an
existing diagnostic. Other original findings may disappear. The final NDJSON is
parsed and linted again, and its diagnostics are mapped back to original indices
for the same verification. Serialization cannot silently replace the target with
a different failing event.

Run starts/terminals/errors, snapshots, subagent announcements, reasoning/step
context, and other non-removable control events are retained. The selected primary
and related events are pinned. The reducer follows message/tool dependencies,
including parent messages and result-message ownership, and retains the relevant
entity's entire recorded history. First/last events are also pinned to preserve
capture context. These conservative constraints can retain more events than a
human would need, including unrelated run envelopes or snapshot content.

The search deletes contiguous groups of unpinned events, checks the candidate, and
refines the group sizes. It never edits fields, sorts events, inserts openers, or
repairs a stream. “Complete” means this search schedule finished under its fidelity
constraints. It does not prove global minimality or that every possible multi-event
combination has been explored. Call the result a reduced reproducer.

## Supported scope

Supported finding rules are FL002, FL004, FL005, FL006, FL007, FL008, RUN_IDENTITY,
RUN_TRANSITION, and ITEM_REOPEN. Findings keep their original severity; partial
captures may produce warning reproducers rather than proof of a producer bug.
Use `--allow-partial` in both listing and reduction if that matches your capture.

Chunk shorthand, STATE_DELTA/ACTIVITY_DELTA, and encrypted-history traces are
unsupported for reduction in this version. Any recorded encryptedValue field also
causes a conservative refusal. Schema-invalid and resource-limit findings prevent
reliable reduction. Unsupported rules/context produce an unchanged verified bundle
with `stopReason: "unsupported"`, an explanation, and CLI exit 2. Per-event graph
limits/cycles, non-JSON-compatible events, and invalid source coordinates are input
errors. Input is limited to 100,000 records and 10 MiB of serialized NDJSON, checked
before concatenating the whole event sequence. A large JSON array may pass the
batch parser but exceed this reducer-specific event limit. There is no repair or
bypass of existing parser limits.

## Budgets, progress, cancellation

Options:

- `--max-checks`: 1–10000 candidate validations, default 200.
- `--max-duration-ms`: 1–60000 ms, default 5000.
- `--progress`: print checks, retained events, and elapsed time to stderr.
- `--allow-partial`: preserve partial-capture checking behavior.

Time and cancellation are cooperative checkpoints between synchronous validations.
Initial preparation, dependency analysis, an individual lint pass, and final
serialization/verification cannot be interrupted mid-operation. The time budget
is not a process timeout or a maximum wall-clock guarantee. Callback time counts
against it. Callback exceptions reject the library operation.

On a check/time limit, the best accepted candidate is verified and written. During
reduction, Ctrl+C
requests cancellation; after the active check, the best accepted candidate is
verified and written with `stopReason: "cancelled"` and CLI exit 130. A second
interrupt can terminate the process immediately. Input reading and output writes
use normal process interrupt behavior. Failed/interrupted writes can
leave an incomplete new directory; inspect it and use another new path on retry.

Exit 0 means a verified bundle was created, including unchanged results or an early
budget stop. It does not mean the reproduced trace passes lint. Exit 2 covers
unsupported reduction, invalid options/IDs/input, and output failures. Exit 130
identifies requested cancellation. Listing itself exits 0 when it succeeds, even
if all findings are unsupported. The manifest's stop reason and `changed` flag
are the authoritative reduction status.

## Library

```ts
import {
  getReproFindings,
  minimizeTrace,
  parseTrace,
} from "@leracherry/flowlint";

const records = parseTrace(traceText);
const finding = getReproFindings(records).find((item) => item.supported);
if (!finding) throw new Error("No supported finding");
const result = await minimizeTrace(records, {
  findingId: finding.id,
  maxChecks: 200,
  maxDurationMs: 5000,
  signal: abortController.signal,
  onProgress: (progress) => console.log(progress),
});
```

`traceText` and `abortController` are supplied by your application. The API returns
`Reproducer` data and does not write files. `getReproFindings` returns `ReproFinding`
records; options for listing are the existing `LintOptions`. `ReproOptions` adds
selection, budgets, signal, and a progress callback. `ReproProgress` contains counts
and elapsed time. Options are copied at entry; abort signals retain their normal
live behavior. Input event data is cloned through JSON serialization. Only plain
JSON values preserved by JSON.stringify are accepted: negative zero, nonfinite
numbers, undefined values, accessors, sparse
arrays, and custom object types are rejected instead of silently changing fields.

## Content handling

Reduction is not redaction. Retained events can still contain messages, arguments,
state, snapshots, credentials in payloads, and other private data. Pinned snapshots
are retained intact. The bundle requests private filesystem modes where supported,
but existing parent permissions and Windows ACLs are not changed. Review both
retained events and metadata before sharing; hashes are not anonymization.

## Verification

The curated suite covers at least 12 supported failures across duplicate/missing
text and tool events, duplicate/reused/mismatched runs, illegal transitions, and
message/tool reopening. Tests check the selected original event and its reason,
severity, context, related identity, unchanged retained values, source mapping,
and final re-linting. A recorded DeepAgents journey tests snapshot-established
reopening evidence. Additional tests cover alternative duplicate causes, no new
lifecycle errors, unchanged results, unsupported contexts, payload retention,
input mutation, budgets, cancellation, stale IDs, and partial captures.

CLI and fresh-package tests verify listing, bundle creation, checksums/contracts,
exit behavior, and refusal to overwrite artifacts. Reduction ratios and runtime
are reported per result. They are observations for that input, not universal
reduction or performance guarantees.
