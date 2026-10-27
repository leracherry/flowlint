# Try FlowLint in a real debugging workflow

Start with one recorded interaction that your team already understands. Keep its
original bytes and producer version, run a check, then decide whether the finding
or evidence links help you locate a concrete problem. A passing trace only covers
recorded protocol evidence; it does not certify application behavior.

## First integration

For the published checker:

```sh
npm install --save-dev --save-exact @leracherry/flowlint@1.1.0
npx flowlint check traces/known-interaction.ndjson --format json
```

Commit your dependency lockfile and the reviewed capture. In an existing Node CI
job, run `npm ci` followed by the same command. Exit 1 is a lint finding; exit 2
means input or usage failed. Treat either as a failing gate. Use `--allow-partial`
only when the input is actually an excerpt and preserve that context in reports.
Do not weaken expected findings simply to make a build pass.

The [capture](capture.md), [suite](../REFERENCE.md#trace-suites),
[HTML report](html-reports.md), [reducer](reproducers.md), and
[comparison](comparison.md) features are included in 1.1.0. The demo and maintenance
scripts require a repository checkout. Record the exact FlowLint version or commit
and lockfile when evaluating results.

## Evaluate usefulness

A voluntary integration report can include:

- Producer/version, FlowLint version or commit, and the observed task.
- A reviewed public trace or a synthetic reproducer with its coverage limits.
- Expected behavior, actual diagnostics, and whether the interpretation was confirmed.
- Time to a first useful result, measured by the participant if they wish.
- Whether the check remained useful through the next adapter upgrade.

Use a [GitHub issue](https://github.com/leracherry/flowlint/issues/new/choose) if you
want to share results. No telemetry or automatic reporting is added. Review
payloads and provenance before making a capture public. A minimized trace can still
contain sensitive messages, arguments, and state.

## Evidence ledger

| Outcome                                   | Verified evidence                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Reproducible recorded finding             | [DeepAgents case study](case-study-deepagents.md), pinned upstream data and controlled derived edits |
| Independent confirmation of that finding  | None recorded                                                                                        |
| External CI integration 1                 | None recorded                                                                                        |
| External CI integration 2                 | None recorded                                                                                        |
| Retention through an external upgrade     | None recorded                                                                                        |
| Measured onboarding/debugging improvement | None recorded                                                                                        |

Only add an adoption result with a dated public link or the participant's
permission to report it. Repository CI, authored examples, stars, and downloads do
not count as external retained usage. The milestone's external exit criterion
remains open until an independent project retains the tool through an upgrade.
