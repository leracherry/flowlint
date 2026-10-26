# Incremental validation

The session and streaming APIs are unreleased on main. The published 1.0.0 package
does not include them. Build the checkout or use a later release that includes
these exports. Existing `lintEvents`, `parseTrace`, and CLI commands retain their
batch contracts.

## Check a byte stream

```ts
import { createReadStream } from "node:fs";
import { lintTraceStream } from "@leracherry/flowlint";

const result = await lintTraceStream(createReadStream("trace.ndjson"), {
  format: "ndjson",
});
console.log(result.valid, result.diagnostics);
```

`lintTraceStream` accepts an `AsyncIterable<Uint8Array>` and explicit `ndjson` or
`sse` framing, defaulting to NDJSON. Buffers are supported; strings are rejected.
JSON arrays and format auto-detection remain in `parseTrace`.

The promise resolves to the existing `LintResult` after a clean source EOF. Parse,
source, or session-limit errors reject it. They are not converted to lint findings
or replaced with misleading EOF findings. On failure, the internal session is
cancelled and the source iterator is closed through normal async iteration.

Streaming reports errors as they are encountered. Batch parsing checks whole-input
byte and line limits before parsing any event. If input contains multiple different
errors, the two modes can therefore report different first failures. Valid input,
source coordinates, and isolated parse error cases are tested for equivalence.

## Observe a session while events arrive

```ts
import { createLintSession, parseTraceStream } from "@leracherry/flowlint";

const session = createLintSession({ allowPartial: true });
try {
  for await (const record of parseTraceStream(source, { format: "sse" })) {
    session.push(record);
    // Take snapshots when needed; copying every diagnostic on every event is costly.
    if (record.eventIndex % 100 === 0) console.log(session.snapshot());
  }
  console.log(session.finish());
} catch (error) {
  session.cancel();
  throw error;
}
```

`source` is your byte stream. A source-aware `SourceEvent` can also be supplied
directly to `push`. Its event index is zero-based; line/column are one-based.
Push events in observed arrival order. Indices are preserved, not renumbered by
the session. As in batch mode, invalid schemas produce diagnostics and are skipped.

| Operation      | Behavior                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `push(record)` | Checks one event synchronously; returns nothing. Throws after closure.                                               |
| `snapshot()`   | Copies findings and counters without EOF checks. Does not end the session.                                           |
| `finish()`     | Applies EOF checks once and changes active status to finished. Repeated calls return equivalent independent results. |
| `cancel()`     | Changes active status to cancelled without EOF checks; returns a snapshot. Repeated calls are harmless.              |
| `status`       | Read-only `active`, `finished`, or `cancelled`.                                                                      |

Calling finish after cancellation returns the current snapshot; status stays
cancelled. Cancelling a finished session leaves it finished. Snapshot validity only
means no observed error findings yet. It does not mean a complete stream, and the
unchanged `LintResult` shape does not carry completion status. Consult session
status and finalize successfully before treating a run as fully checked.

Snapshots are detached, including related locations and field lists. Mutating them
cannot change future checks. Options are copied when the session is created.
Finish does not retain the original last event payload merely to locate EOF errors.

Session cancellation does not abort an independent network request, drain a source,
or call `return()` on an iterator you manage separately. Break/return from the
parser loop and use your source's normal cancellation or AbortController mechanism.
If a source is waiting indefinitely, neither EOF nor a transport error has occurred.

## Limits and memory

New sessions default to `maxEvents: 100000`, including schema-invalid supplied
records. A positive safe integer overrides this explicit event-count budget. The
next push at the limit cancels the session and throws `TraceInputError` with code
`LIMIT_SESSION` and the rejected record's coordinates. The rejected event is not
counted or processed. Discard or inspect the cancelled session; it is not complete.

`lintEvents` preserves its existing array behavior by setting its session budget to
the supplied array length. It does not gain a new 100,000-event restriction. The
normal parser's byte, depth, node, and line limits still apply where documented.

`parseTraceStream` retains the pending physical line or SSE frame and UTF-8
decoder state, in addition to the current source chunk and its decoded text.
A caller can supply a large chunk; prefer ordinary bounded read sizes. The parser
does not accumulate previously emitted events or earlier chunks.
Pending segments are combined geometrically, avoiding an array entry for every
one-byte chunk. SSE framing is interpreted with original physical source lines
and columns; output records do not expose raw bytes. Use capture for raw provenance.

Streaming parsing keeps the 10 MiB total input limit and the 100,000-physical-line
limit, including trailing empty lines. It does not provide an unlimited long-lived
stream. An incomplete final SSE data block remains `PARSE_SSE_TRUNCATED`; partial
capture mode cannot repair transport framing. Byte budgets count bytes before UTF-8
decoding, and split characters/CRLF pairs are handled across chunks. The original
batch BOM behavior is preserved, including rejection of BOM-prefixed NDJSON.

Validation still retains entity IDs, run history, ownership, conversation metadata,
and patch baselines needed for correctness. The existing diagnostic cap and patch
budgets remain active. Snapshot calls copy up to the diagnostic cap plus its limit
marker. Direct sessions are bounded by event count and per-event limits rather
than a fixed RAM guarantee. Raising maxEvents can increase retained history. No
history is silently evicted, and cancelling does not promise to release every
internal allocation immediately; discard the session when it is no longer needed.

The CLI's existing file/stdin loading and suite aggregation are unchanged and still
buffer input. Use these library APIs when incremental consumption is needed.

## Verification

Before refactoring, 108 results were saved from examples and valid/invalid/producer
fixtures in complete and partial modes. The refactored batch API matched those
results exactly, independently of the new session wrapper. These baseline files
were an implementation-time comparison, not a new regenerated acceptance corpus.

Committed tests check every byte split on small UTF-8/CRLF/multiline fixtures and
deterministic varied partitions across all recorded producer fixtures and authored
rule fixtures. Tests also cover source cleanup, cancellation, option/snapshot
isolation, caps, boundary locations, byte/line limits, and a frame at the byte cap.

`pnpm stress` now also runs isolated NDJSON/SSE workers for RAW events, thousands
of runs/entities, repeated state patches, and interleaved subagents/steps. Workers
have the existing 256 MiB V8 old-space ceiling and 30-second timeout. They generate
chunks as they go rather than constructing a full trace or record array. Output
reports end-of-run heap and OS-reported peak RSS; RSS includes more than V8 heap,
so the old-space ceiling is not a process-RAM limit. These workloads document
observations and regressions, not universal performance guarantees.
