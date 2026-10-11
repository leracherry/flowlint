# Contributing

Use Node.js 22+ and pnpm 10.17.1. Run `pnpm install`, then `pnpm check`.
Run `pnpm format` before committing. Tests include bundled CLI integration checks.

Add regression cases for both broken traces and legal streams before expanding
rule coverage. Reuse the official AG-UI schemas, preserve source locations, and
keep event content out of diagnostics. Arrival order is authoritative.

Distribution automation is implemented. Explicit lifecycle
rules, text/tool chunk normalization (FL010/FL011), and EOF checks are implemented. Add each new rule with its ID and
coverage in README, paired valid/invalid fixtures, and partial-capture regressions.
SSE parsing and reasoning/subagent lifecycle checks are later work.

Run `pnpm verify:package` to check the distributable in a fresh consumer project.
See [RELEASING.md](RELEASING.md) for GitHub and npm release instructions.
Include an entry in CHANGELOG.md for each release.
