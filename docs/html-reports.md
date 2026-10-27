# Local HTML reports

The report command and `generateHtmlReport` API are available from 1.1.0.

```sh
npm install --save-dev --save-exact @leracherry/flowlint@1.1.0
npx flowlint report trace.ndjson --output report.html
npx flowlint report stream.sse --output stream-report.html --allow-partial
npx flowlint report trace.json --output small-report.html --max-events 500
```

Open the generated HTML file directly in your browser. It contains its own styles
and filtering script, with no external fonts, scripts, images, or automatic network
requests. Findings and event links also work when JavaScript is disabled. Rule
reference links open online documentation only when selected.

## Find the relevant events

The report shows checked event/error/warning totals, findings, and a timeline grouped
by recorded run and explicit agent tag. Each finding links to its primary event;
related evidence links point to earlier establishing events, such as the snapshot
that supplied a reopened tool's attributes. Linked rows receive focus and a visible
highlight. If a filter hid that row, following the evidence link clears the filter.

The search box filters rendered event types, identifiers, run IDs, agent tags, and
event indices. It does not search omitted events or payloads. Clear resets the
filter. The page includes a skip link, labelled input, visible keyboard focus,
live result count, responsive layout, and print styles.

Groups follow observed RUN_STARTED fields and explicit subagentRunId tags; they
are not a reconstruction of the validator's resolved ownership state. Untagged
events are labelled accordingly. Events within a group retain arrival order, and
indices retain the cross-group source sequence. Grouping does not imply legal run
transitions, concurrency timing, or correct ownership. Review the findings.

## Content and coverage

The HTML includes bounded event types, identifiers, source locations, source name,
and diagnostic messages. It does not embed raw event JSON, message bodies, tool
names/arguments, state or activity values, or opaque artifacts. There is no hidden
raw-payload toggle: omitted fields are absent from the artifact, not merely hidden
with CSS. Identifiers, filenames, and diagnostics can still contain sensitive
information; inspect them before sharing the report.

Trace-controlled labels are escaped in text and attributes. A restrictive Content
Security Policy permits only the exact bundled script and stylesheet hashes and
blocks other automatic resource loads. No remote service is contacted to generate
or display the report. These protections apply to the generated file; modifying
it later can change its behavior.

A clean report means no errors under the implemented checks, not full protocol
certification. Partial mode can downgrade uncertain capture-boundary findings to
warnings. Missing state/activity baselines can make applicability unknown; review
those warnings. Coverage and timeline limitations are visible in the report.

## Limits and exit codes

All supplied events are linted, even if only some timeline rows are rendered.
The default render limit is 2,000 events. `--max-events` accepts an integer from 1
through 10,000. Events referenced by findings and related evidence are prioritized
in diagnostic order, then remaining capacity is filled from the start of the trace.
Selected rows appear in their original source order within each group.

The report displays rendered/omitted counts and labels unavailable evidence links.
Metadata labels are shortened after 160 characters (source names after 500), and
finding messages after 1,000. Use JSON diagnostics and the original trace for full
values. Distinct identities retain separate groups even when shortened display
labels match. Group counts describe rendered groups, not an exhaustive agent count.

Generation uses batch validation and retains the source records and HTML string.
The CLI keeps its existing input byte/depth/line limits; this command is not a
streaming renderer or a constant-memory pipeline. Output growth is bounded by row,
label, and diagnostic limits rather than a universal fixed byte-size guarantee.

Exit codes match checking: 0 for no lint errors, 1 when an HTML report was created
with lint errors, and 2 for usage, input/parsing, or output failure. Parse failures
do not create a report. `--output` is required; files are created exclusively and
existing files are never overwritten. A new writable filename is required on each
run. An output failure uses `REPORT_WRITE` and does not replace the source trace.
The command prints the written filename; it does not open a browser automatically.

Additional options are `--input auto|ndjson|json|sse` and `--allow-partial`. Stdin
is supported as `report - --output report.html`.

## Library

```ts
import { generateHtmlReport, parseTrace } from "@leracherry/flowlint";
import { readFile, writeFile } from "node:fs/promises";

const records = parseTrace(await readFile("trace.ndjson", "utf8"));
const html = generateHtmlReport(records, {
  source: "trace.ndjson",
  maxEvents: 2000,
  allowPartial: false,
});
await writeFile("report.html", html, { flag: "wx", mode: 0o600 });
```

`HtmlReportOptions` extends `LintOptions` with optional `source` and `maxEvents`.
The function lints the supplied source-aware records and returns a deterministic
standalone HTML string. It does not read or write files. Invalid render limits
throw RangeError. Styling, layout, and DOM selectors are not public API contracts;
use the stable JSON diagnostic interface for automation. HTML output can change
between compatible releases.

## CI artifact example

In a consumer project with a suite/report-capable version pinned in its lockfile,
after checkout, Node setup, and `npm ci`:

```yaml
- name: Generate report
  run: npx --no-install flowlint report traces/regression.ndjson --output trace-report.html
- name: Upload report
  if: always()
  uses: actions/upload-artifact@v7.0.2
  with:
    name: trace-report
    path: trace-report.html
    if-no-files-found: ignore
```

The generation step retains its failing exit code. This snippet uses GitHub's
artifact action; it is not required for local report generation. Only upload
reports your team intends to share with people who can access the CI artifacts.

## Verification and local observations

`pnpm check` includes artifact tests for omitted payloads, escaping, exact policy
hashes, evidence prioritization, limits, deterministic output, and CLI failure
behavior. Fresh-package verification checks the installed CLI and library export.

Run `pnpm exec playwright install chromium`, then `pnpm test:html`, for real-browser
checks of offline loading, evidence links, filtering, keyboard focus, mobile width,
hostile identifiers, the policy, and navigation without JavaScript. A separate
Linux/Chromium CI job runs these checks in addition to the normal operating-system
matrix. This is not a claim that every browser or assistive technology was tested.

The large-trace regression checks 20,002 events while rendering 2,000, and requires
the fixture's artifact to stay under 1.5 MB. That bound describes this fixture,
not every possible report. Browser checks use a real recorded DeepAgents journey.
