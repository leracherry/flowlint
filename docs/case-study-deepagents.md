# Finding a missing parent in a recorded DeepAgents resume

A public DeepAgents approval journey contains 72 AG-UI events. FlowLint reports
two reopened tool calls that omit their established `parentMessageId`. The useful
result is a direct link from each conflicting opener to the snapshot that
established its parent, plus a smaller reproducible input.

## Evidence

The input comes from the AG-UI project's browser integration suite at revision
`89cedd3fd549feeee41e50e1d7c6d373e549241a`:

- [Original recorded journeys](https://github.com/ag-ui-protocol/ag-ui/blob/89cedd3fd549feeee41e50e1d7c6d373e549241a/apps/dojo/e2e/tests/langgraphFastAPITests/deepagentsSubagentsPage.event-trace.ts)
- [Pinned tool-call specification](https://github.com/ag-ui-protocol/ag-ui/blob/89cedd3fd549feeee41e50e1d7c6d373e549241a/docs/spec/1.0/events/tool-calls.mdx)
- [Local fixture and SHA-256 provenance](../test/fixtures/producers/manifest.json)

The upstream suite uses controlled model responses and normalizes generated IDs
before storing these recordings. They are real integration-test outputs, not
private production traces. The exact imported approval fixture SHA-256 is
`40601a65d483431c5ab60389ff4d130bc6e2f83c177f443a2c4e43059dbf07a8`.

## Diagnosis and evidence

The snapshot at zero-based event 35 establishes the two tool calls. The openings
at events 38 and 55 omit their established parent. FlowLint emits `ITEM_REOPEN`
with those primary locations and event 35 as related evidence. The pinned
specification requires reopening attributes to remain consistent. The finding
does not imply that every UI detects or rejects the disagreement.

A separate rejection journey has the same kind of findings at events 38 and 52.
Together these are the four expected errors in the 19-journey, 918-event corpus.
Exact expectations remain checked in; the recordings are not repaired to make CI
pass. The corpus tests verify the errors as expected evidence.

## Reproduce and test the explanation

Run `pnpm demo` from a built-capable checkout and follow the
[90-second walkthrough](demo.md). The script verifies the fixture checksum and
creates a report, findings JSON, a reduced trace, and two explicitly derived copies.

On the baseline source, reduction retains 51 of the approval trace's 72 events
while preserving the selected error and its establishing snapshot. The generated
manifest records the actual budget outcome and mapping; reduction is conservative
and not globally minimal.

Adding the two established parent IDs to a derived copy produces zero findings.
Removing the first added parent again produces the expected error at event 38.
Those controlled changes support the missing-parent explanation and demonstrate a
saved-trace regression check. They do not establish that an adapter implementation
has been fixed.

## What this establishes

The recording supports a reproducible, specification-backed finding and a
reviewable diagnostic workflow. It does not establish a production outage,
independent maintainer confirmation, an accepted upstream fix, or retained external
CI usage. There is no measured debugging-time reduction or false-positive rate.
Those adoption outcomes remain open in the [evidence ledger](adoption.md).
