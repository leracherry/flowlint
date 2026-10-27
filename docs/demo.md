# A 90-second walkthrough

Use this walkthrough after installing dependencies and building the checkout.
The generated artifacts contain a public upstream recording and clearly named
derived copies. No model, credentials, or network access is needed for the demo.

```sh
git clone --branch v1.1.0 https://github.com/leracherry/flowlint.git
cd flowlint
pnpm install --frozen-lockfile
pnpm demo
```

Use Node 22+ and pnpm 10.17.1. `pnpm demo` builds the checkout and
creates a new `demo-output/` directory. It refuses to overwrite an existing run.
For another run, choose a new directory: `pnpm demo ./another-demo`.
The 90 seconds below are a presentation script, not measured first-time onboarding.

## 0–20 seconds: identify the finding

```sh
node dist/cli.js check demo-output/original.ndjson
```

Expected exit: **1**. The 72-event recording has two `ITEM_REOPEN` findings, at
zero-based events 38 and 55 (lines 39 and 56). Both calls reopen without the
`parentMessageId` established in the message snapshot at event 35 (line 36).

## 20–45 seconds: inspect the evidence

Open `demo-output/report.html` in a browser. Follow either finding's establishing
event link to event 35. The report connects the conflicting opener to the snapshot
that defines its parent. `findings.json` provides the same coordinates for CI.

The reducer retains 51 of 72 events in the current baseline while preserving the
selected finding and snapshot. `reproducer.json` records the actual count, search
stop reason, source mapping, and verified result for this run. This is an observed
reduction, not a promise of the smallest possible trace.

## 45–65 seconds: explain the derived correction

```sh
node dist/cli.js check demo-output/derived-corrected.ndjson
```

Expected exit: **0**, no findings. This copy adds only the two snapshot-established
parent IDs. `provenance.json` lists both edits and hashes. The original recorded
fixture is untouched. This illustrates the constraint; it is not an upstream patch.

## 65–90 seconds: prevent the regression

```sh
node dist/cli.js check demo-output/derived-regression.ndjson
```

Expected exit: **1**. Removing the first parent again restores the finding at
event 38. The same command can gate a saved capture in CI. The demo itself asserts
the original findings, corrected result, reintroduced finding, and retained evidence,
so incorrect output fails the demo rather than printing a success story.

Read the [recorded case study](case-study-deepagents.md) for provenance, protocol
basis, and limitations. Artifacts retain upstream MIT attribution. They include
public recorded payloads; private captures need separate review before sharing.
