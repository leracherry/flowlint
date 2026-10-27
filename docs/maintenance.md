# Maintain recorded compatibility evidence

Required CI runs the pinned producer corpus offline. The separate **Producer
compatibility** workflow runs Mondays at 08:17 UTC and on manual dispatch. It
resolves upstream `main` to a full commit, fetches only the source files already
listed in the manifest, interprets their recorded data, and compares each journey
with the pinned fixture using the current FlowLint build.

```sh
pnpm build
node scripts/check-producer-updates.mjs ./producer-check
# Or replay a specific immutable upstream revision:
node scripts/check-producer-updates.mjs ./another-check 89cedd3fd549feeee41e50e1d7c6d373e549241a
```

Output directories must be new. Network access is required; `GH_TOKEN` is optional
locally and used only for the GitHub API revision lookup. Each request has a
15-second timeout, rejects redirects, and accepts at most 2 MiB. Upstream TypeScript
is parsed as a restricted data format and never imported or executed. Unsupported
syntax leaves the result unavailable.

The output contains versioned `report.json` and `summary.md`, with the FlowLint
source commit, working-tree status, and pinned schema version. Each watched source
has an immutable link and checksum. Journey entries include input hashes, event
counts, validity, and up to 50 diagnostics per side with an omitted count. The
workflow saves these artifacts for 30 days and adds its summary to the run page.
It has read-only repository permissions and does not create issues or change pins.

| Exit | Meaning                                                                                           | Maintainer action                                       |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 0    | Watched inputs are unchanged or their exact source hashes were reviewed; findings remain visible. | No unreviewed source drift in these files.              |
| 1    | Unreviewed source or journey changes, additions, or removals.                                     | Review the immutable diff and coverage before updating. |
| 2    | Baseline verification, download, parsing, or validation could not complete.                       | Restore coverage; do not interpret this as a pass.      |

Both nonzero results fail the maintenance workflow so they need attention. This
workflow is separate from required pull-request CI. A newer upstream commit alone
is not drift when all watched source and journey bytes remain the same. A source
change with identical event data still requires review because recording logic or
metadata may have changed.

## Reviewed source changes

`scripts/producer-reviews.json` records an immutable source revision, exact SHA-256,
and a review reason for known drift. The watcher reports matching entries as
`reviewed` (exit 0), retains the before/after journey details, and alerts again
when those bytes change. A review cannot hide a missing, unreadable, or unsupported
source. It is a source-change acknowledgement, not a waiver of lint findings.

The initial entry reviews a [DeepAgents snapshot identity change](https://github.com/ag-ui-protocol/ag-ui/compare/89cedd3fd549feeee41e50e1d7c6d373e549241a...4eac7a982228267dde4f80207e8a9a1351b4aba8).
Two stored tool-result message IDs changed from `id-13` to `id-4`; journey event
counts and all four expected reopening findings stayed the same. The original
corpus remains pinned. This observation is not independent confirmation of the
parent-identity finding.

## Review an update

1. Verify the baseline fixture hashes and expected findings with
   `pnpm exec vitest run test/producer-traces.test.ts`.
2. Review source changes, journey additions/removals, recording normalization,
   licensing, and diagnostic changes. Check protocol interpretations independently.
3. Record an exact source-hash acknowledgement and reason after review if retaining
   the current corpus. If adopting the candidate, retain its full revision, source hashes, fixture
   hashes, and upstream license. The importer accepts an optional third argument
   containing the full revision; use temporary output directories first.
4. Update the [coverage matrix](coverage.md) and exact expectations only with a
   written reason. New default acceptance failures need compatibility review under
   [COMPATIBILITY.md](../COMPATIBILITY.md).
5. Run the full checks and package verification, then submit the evidence for review.

The watcher does not discover new source paths, monitor schema releases, run live
producer applications, compare transport bytes, or establish real-world behavior.
Review new producers and event families manually. Recorded expected errors do not
make the maintenance workflow fail when its inputs are unchanged.

## Triage

Labels describe the reported category, not a confirmed conclusion:

| Label                | Use                                                                   |
| -------------------- | --------------------------------------------------------------------- |
| `false positive`     | A finding appears to reject a valid recorded interaction.             |
| `missing coverage`   | A relevant invalid behavior or event family is not detected.          |
| `producer ambiguity` | The recording or specification does not establish one interpretation. |
| `integration issue`  | Capture, install, CLI, report, or CI setup prevents use.              |

Ask for versions, complete/partial capture context, expected behavior, exact
findings, and a reviewed minimal trace. Confirm the protocol basis before labeling
a producer defective. Link resolutions to regression tests or explicit coverage
limits. Keep unconfirmed reports distinct from the [adoption evidence](adoption.md).
