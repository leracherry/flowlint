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

## Implemented: recorded regression suites

- [x] Add a separate suite command with deterministic file discovery and aggregate
      results, retaining the existing single-file check contract.
- [x] Provide escaped GitHub annotations and a sample CI integration.

## Next: capture integration

- [x] Add Node HttpAgent capture with raw SSE, bounded retention, cancellation,
      provenance manifests, a runnable example, and controlled integration tests.
- [ ] Validate capture-to-CI onboarding and overhead with an independent application
      maintainer. See [capture integration](docs/capture.md).

## After integration feedback

- [x] Add incremental sessions and NDJSON/SSE byte parsing with equivalence tests,
      explicit limits, and retained-history/patch/subagent stress workloads. See
      [incremental validation](docs/incremental.md).
- [x] Generate a local HTML report with evidence navigation, metadata filtering,
      bounded timelines, payload omission, and offline browser verification. See
      [HTML reports](docs/html-reports.md).
- [x] Reduce selected explicit lifecycle/reopening failures with pinned context,
      verified finding identity, source mappings, budgets, and reviewed artifact
      bundles. Chunk/patch/encrypted-history reduction remains unsupported. See
      [reproducers](docs/reproducers.md).
- Compare adapter upgrades using explicit policies that preserve ownership and
  meaningful ordering, reporting ambiguity rather than assuming equivalence.

Each feature must have independently verifiable acceptance criteria. New
protocols, hosted dashboards, and automatic event repairs are outside this sequence.
