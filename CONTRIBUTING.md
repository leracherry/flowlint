# Contributing

Use Node.js 22+ and pnpm 10.17.1. Run `pnpm install`, then `pnpm check`.
Run `pnpm format` before committing. Tests include bundled CLI integration checks.

Add regression cases for both broken traces and legal streams before expanding
rule coverage. Reuse the official AG-UI schemas, preserve source locations, and
keep event content out of diagnostics. Arrival order is authoritative.

Add each new rule to REFERENCE.md with its ID, severity, and coverage limits.
Include valid and invalid examples, plus partial-capture regressions where relevant.
See [ROADMAP.md](ROADMAP.md) for completed phases and remaining gaps.

Run `pnpm verify:package` to check the distributable in a fresh consumer project.
See [RELEASING.md](RELEASING.md) for GitHub and npm release instructions.
Include an entry in CHANGELOG.md for each release.
