# Contributing

Use Node.js 22+ and pnpm 10.17.1. Run `pnpm install`, then `pnpm check`.
Run `pnpm format` before committing. Tests include bundled CLI integration checks.

Add regression cases for both broken traces and legal streams before expanding
rule coverage. Reuse the official AG-UI schemas, preserve source locations, and
keep event content out of diagnostics. Arrival order is authoritative.

The next milestone is chunk normalization and FL010/FL011. Explicit lifecycle
rules and EOF capture checks are implemented. Add each new rule with its ID and
coverage in README, paired valid/invalid fixtures, and partial-capture regressions.
SSE parsing and reasoning/subagent lifecycle checks are later work.

To release, update `package.json` and its lockfile, commit to main, then push a
matching version tag (for example `v0.1.0`). The release workflow runs all checks
on Node 22 and 24, tests the installable package, and creates a GitHub Release
with a tarball and SHA-256 checksum. It does not publish to npm. Check package-name
availability and configure publishing separately before an npm release.
