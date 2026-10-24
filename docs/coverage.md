# Coverage and validation baseline

FlowLint checks recorded protocol evidence. A clean result is not certification
of an adapter, model, consumer, or complete application.

## Reproducible baseline

The 1.0 source revision `08ed308c82ae9a5b7319d52efe6bbbdc327d592a` passed 475 tests
across 13 files in a local Node 24.22.1 check on October 24, 2026. Type checking,
building, and the existing stress script also passed. These local observations do
not substitute for the repository's Node 22/24 operating-system CI matrix.

The stress script checks 25,002 events in each input format under a subprocess
heap ceiling and timeout. Its RAW-event workload is not a benchmark of patch
history, many retained entities, or arbitrary concurrent scheduling. Reported
heap is end-of-run usage, not peak memory.

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

No interviews or external adoption are claimed by this baseline. Do not change
recorded fixtures or loosen expectations just to make the corpus pass.
