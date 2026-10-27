# Coverage and validation baseline

FlowLint checks recorded protocol evidence. A clean result is not certification
of an adapter, model, consumer, or complete application.

## Reproducible baseline

The pinned corpus has 19 journeys and 918 events, with exact fixture hashes and
four expected reopening findings. Required CI replays it offline on Node 22/24
across Linux, macOS, and Windows. This is recorded integration-test evidence,
not a production-load or adapter certification claim.

Before this maintenance milestone, main at
`f682fab6fd6bcde18ccec6e96e0d86aff9d9ff63` passed 698 tests and seven CI jobs.
Current counts are reported by CI rather than treated as a coverage percentage.
Batch, streaming, and comparison stress checks use isolated subprocess budgets;
streaming workers also report peak RSS. These measurements are workload-specific.

The separate [producer compatibility workflow](maintenance.md) watches pinned
source paths at a newly resolved immutable upstream revision. It reports source,
journey, and diagnostic changes without updating fixtures or executing upstream
code. Network/parser failures leave coverage unavailable. It does not discover
new producer paths or run live adapters.

## Evidence matrix

The [reference](../REFERENCE.md#current-coverage) lists every implemented rule.
The following matrix distinguishes authored regression coverage from recorded
producer evidence; it does not claim every rule is exercised by the recordings.

| Area                      | Regression tests              | Recorded evidence and gaps                                      |
| ------------------------- | ----------------------------- | --------------------------------------------------------------- |
| Run, text, tool lifecycle | lifecycle, core               | Chat, calls, results, interruptions; no RUN_ERROR events        |
| Chunk normalization       | chunks, hardening             | No chunk events in the recorded corpus                          |
| Ownership and subagents   | subagents                     | Nested subagents/subgraphs; arbitrary scheduling unverified     |
| Reasoning and steps       | reasoning-steps               | Reasoning/step journeys; not exhaustive combinations            |
| Reopening and history     | conversation, producer-traces | Two DeepAgents journeys retain four expected reopening findings |
| State patches             | state-patches, hardening      | Recorded snapshots; no STATE_DELTA                              |
| Activity patches          | activity-patches, hardening   | No recorded activity events                                     |
| Encrypted artifacts       | conversation                  | No recorded encrypted-value events                              |
| SSE transport             | sse, producer-traces          | Derived framing only; original transport bytes unavailable      |
| Resource limits           | hardening, stress             | Authored adversarial cases, not a production-load guarantee     |

All tests are in [test/](../test/). Recorded inputs and exact finding expectations
are unchanged by the evidence feature; diagnostics now also identify the event
that established the conflicting attributes.

## Feature evidence

| Capability           | Automated evidence                                                                     | External gap                             |
| -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| Diagnostic evidence  | Exact source/related coordinates and pinned recorded findings                          | Independent interpretation review        |
| Capture              | Controlled HttpAgent SSE, cancellation, limits, provenance                             | Real application overhead and onboarding |
| Incremental checks   | Batch equivalence, byte partitions, cancellation, stress                               | Production load patterns                 |
| Local HTML reports   | Offline Chromium navigation, filtering, CSP, payload omission                          | Observed maintainer debugging tasks      |
| Reproducers          | Selected-finding fidelity, retained values, no new errors, recorded snapshot case      | Maintainer use of a shared reproducer    |
| Comparison           | Renaming/rechunking, ownership/state changes, explicit uncertainty, derived recordings | A real external before/after upgrade     |
| Demo and maintenance | Exact recorded finding/counterfactual assertions, offline watcher regressions          | External retained CI usage               |

## Producer findings

The corpus includes 19 journeys and 918 events. Two DeepAgents resume journeys
reopen tool calls without their established parent. See the
[corpus provenance and pinned specification](../test/fixtures/producers/README.md).
The authoritative message snapshot at event 35 establishes both affected tools;
related diagnostics point to that snapshot, not an obsolete earlier opener.
These remain recorded, specification-backed findings, not claims of an upstream
acknowledgement or demonstrated production outage.

## Next validation work

- Obtain independent review of ambiguous protocol interpretations.
- Observe five maintainers' debugging workflows and recruit two design partners.
- Add licensed recordings for missing event families with exact source provenance.
- Evaluate onboarding time and retained external CI usage.

See the [case study](case-study-deepagents.md) and [adoption ledger](adoption.md).
No interviews or external adoption are claimed by this baseline. Do not change
recorded fixtures or loosen expectations just to make the corpus pass.
