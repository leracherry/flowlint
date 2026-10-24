# Roadmap

FlowLint turns recorded AG-UI streams into explainable, repeatable regression
checks. Existing behavior follows [COMPATIBILITY.md](COMPATIBILITY.md).
The [implementation history](docs/implementation-history.md) records the work
that shipped through 1.0.

## Current: explain failures and establish coverage

- [x] Document the current validation baseline and recorded coverage gaps.
- [x] Centralize rule identifiers and descriptions without changing acceptance.
- [x] Link reopening findings to the source event that established attributes.
- [x] Preserve evidence from explicit events, chunks, snapshots, and run input.
- [ ] Validate the capture-to-CI workflow with independent adapter maintainers.
- [ ] Extend related-event evidence to ownership and lifecycle findings.
- [ ] Add rule-level specification references and explicit coverage prerequisites.

See [coverage and validation](docs/coverage.md). Engineering progress does not
establish demand: interviews, design partners, and confirmed upstream findings
remain outstanding.

## Next: make recorded regression suites easy to adopt

- Add a separate suite command with deterministic file discovery and aggregate
  results, retaining the existing single-file check contract.
- Provide escaped GitHub annotations and a sample CI integration.
- Demonstrate faithful capture in one real integration, preserving event order,
  cancellation, source provenance, and content-handling boundaries.

## After integration feedback

- Extract incremental validation with batch-equivalence tests and explicit limits.
- Generate a local HTML report focused on diagnostic evidence.
- Reduce selected lifecycle failures while preserving their original cause and
  required context.
- Compare adapter upgrades using explicit policies that preserve ownership and
  meaningful ordering, reporting ambiguity rather than assuming equivalence.

Each feature must have independently verifiable acceptance criteria. New
protocols, hosted dashboards, and automatic event repairs are outside this sequence.
