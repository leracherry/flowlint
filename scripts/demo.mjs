import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  lintEvents,
  parseTrace,
  generateHtmlReport,
  getReproFindings,
  minimizeTrace,
} from "../dist/index.js";

const output = process.argv[2] ?? "demo-output";
if (process.argv.length > 3)
  throw new Error("Usage: node scripts/demo.mjs [NEW_OUTPUT_DIR]");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const serialize = (events) =>
  events.map((event) => JSON.stringify(event)).join("\n") + "\n";
const manifest = JSON.parse(
  await readFile("test/fixtures/producers/manifest.json", "utf8"),
);
const trace = manifest.traces.find(
  (t) => t.journey === "approvesSubagentAnswer",
);
assert(trace);
const inputPath = join("test/fixtures/producers", trace.file);
const input = await readFile(inputPath, "utf8");
assert.equal(hash(input), trace.sha256);
const records = parseTrace(input);
const original = lintEvents(records);
assert.deepEqual(
  original.diagnostics.map((d) => [
    d.ruleId,
    d.eventIndex,
    d.related?.[0]?.eventIndex,
  ]),
  [
    ["ITEM_REOPEN", 38, 35],
    ["ITEM_REOPEN", 55, 35],
  ],
);

// This is an explicit counterfactual copy, never a modification of the recording.
const derived = structuredClone(records.map((record) => record.event));
const changes = original.diagnostics.map((d) => {
  const event = derived[d.eventIndex];
  const snapshot = derived[d.related[0].eventIndex];
  const parent = snapshot.messages.find((message) =>
    message.toolCalls?.some((tool) => tool.id === event.toolCallId),
  );
  assert(parent, "The authoritative snapshot must establish the tool's parent");
  assert.equal(event.parentMessageId, undefined);
  event.parentMessageId = parent.id;
  return {
    eventIndex: d.eventIndex,
    field: "parentMessageId",
    value: parent.id,
    evidenceEventIndex: d.related[0].eventIndex,
  };
});
const corrected = serialize(derived);
assert.deepEqual(lintEvents(parseTrace(corrected)).diagnostics, []);
const regression = structuredClone(derived);
delete regression[changes[0].eventIndex].parentMessageId;
const regressed = serialize(regression);
assert.deepEqual(
  lintEvents(parseTrace(regressed)).diagnostics.map((d) => [
    d.ruleId,
    d.eventIndex,
  ]),
  [["ITEM_REOPEN", 38]],
);
const finding = getReproFindings(records).find(
  (f) => f.supported && f.diagnostic.eventIndex === 38,
);
assert(finding);
const reduced = await minimizeTrace(records, {
  findingId: finding.id,
  maxChecks: 200,
  maxDurationMs: 5000,
});
assert(reduced.changed && reduced.stats.retainedEvents < records.length);
assert(reduced.validation.diagnostics.some((d) => d.ruleId === "ITEM_REOPEN"));
assert(reduced.mapping.some((m) => m.original.eventIndex === 35));

await mkdir(output);
const write = (name, value) =>
  writeFile(join(output, name), value, { flag: "wx" });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = Boolean(
  execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
  }).trim(),
);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await write("original.ndjson", input);
await write("findings.json", JSON.stringify(original, null, 2) + "\n");
await write(
  "report.html",
  generateHtmlReport(records, {
    source: "Recorded DeepAgents reopening evidence",
  }),
);
await write("derived-corrected.ndjson", corrected);
await write("derived-regression.ndjson", regressed);
await write("reduced.ndjson", reduced.ndjson);
const { ndjson: _ndjson, ...reproducer } = reduced;
void _ndjson;
await write("reproducer.json", JSON.stringify(reproducer, null, 2) + "\n");
await write(
  "LICENSE.upstream",
  await readFile("test/fixtures/producers/LICENSE.upstream"),
);
await write(
  "provenance.json",
  JSON.stringify(
    {
      schemaVersion: 1,
      packageVersion: pkg.version,
      sourceCommit,
      workingTreeModified: dirty,
      producerRevision: manifest.revision,
      source: trace.source,
      sourceSha256: trace.sourceSha256,
      originalSha256: trace.sha256,
      derivedCorrectedSha256: hash(corrected),
      derivedRegressionSha256: hash(regressed),
      transformations: changes,
      evidence:
        "Public upstream normalized recording with controlled model responses; derived edits are not a released upstream fix or independent confirmation.",
    },
    null,
    2,
  ) + "\n",
);
const summary = `# FlowLint recorded-evidence demo

Original: ${records.length} events, two ITEM_REOPEN findings at events 38 and 55.
Both point to the authoritative message snapshot at event 35 (line 36).

Derived correction: add the snapshot-established parentMessageId to those two tool
openings. Zero findings. The original fixture remains byte-for-byte unchanged.

Derived regression: remove the first added parent. ITEM_REOPEN returns at event 38.

Reduced reproducer: ${reduced.stats.retainedEvents} of ${records.length} events,
${reduced.stats.checks} checks, stop reason ${reduced.stopReason}. The selected
finding and snapshot evidence remain. See reproducer.json for verification and mapping.

Open report.html to inspect the source evidence. See provenance.json and
LICENSE.upstream before sharing artifacts. The source is a public normalized
recording; the derived correction is not an upstream fix or production outcome.
`;
await write("summary.md", summary);
assert.equal(hash(await readFile(inputPath, "utf8")), trace.sha256);
console.log(summary);
console.log(`Artifacts written to ${JSON.stringify(output)}`);
