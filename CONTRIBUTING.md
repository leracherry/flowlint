# Contributing

Use Node.js 22+ and pnpm 10.17.1. Run `pnpm install`, then `pnpm check`.
Run `pnpm format` before committing. Tests include bundled CLI integration checks.

Add regression cases for both broken traces and legal streams before expanding
rule coverage. Reuse the official AG-UI schemas, preserve source locations, and
keep event content out of diagnostics. Arrival order is authoritative.

Classify behavior changes using [COMPATIBILITY.md](COMPATIBILITY.md). A new default
error or stricter acceptance requires a breaking release, even for a bug fix.
Do not update recorded-trace expectations merely to make new failures pass.

Add each new rule to REFERENCE.md with its ID, severity, and coverage limits.
Include valid and invalid examples, plus partial-capture regressions where relevant.
See [ROADMAP.md](ROADMAP.md) for completed phases and remaining gaps.

Run `pnpm verify:package` to check the distributable in a fresh consumer project.
See [RELEASING.md](RELEASING.md) for GitHub and npm release instructions.
Include an entry in CHANGELOG.md for each release.

The [recorded producer corpus](test/fixtures/producers/README.md) runs offline in
normal CI. Keep source provenance and checksums when adding recordings. Review
findings against the protocol; do not assume every upstream recording is valid.
