import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { lintEvents, parseTrace } from "../dist/index.js";
const formats = ["ndjson", "json", "sse"];
if (process.argv[2] === "--worker") {
  const format = process.argv[3];
  assert(formats.includes(format));
  const events = [
    { type: "RUN_STARTED", threadId: "stress", runId: "r" },
    ...Array.from({ length: 25000 }, (_, i) => ({
      type: "RAW",
      event: { i, text: "x".repeat(100) },
    })),
    { type: "RUN_FINISHED", threadId: "stress", runId: "r" },
  ];
  const input =
    format === "json"
      ? JSON.stringify(events)
      : format === "sse"
        ? events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")
        : events.map((e) => JSON.stringify(e)).join("\n");
  const before = performance.now();
  const result = lintEvents(parseTrace(input, { format }));
  assert.equal(result.checkedEvents, events.length);
  assert.deepEqual(result.diagnostics, []);
  console.log(
    JSON.stringify({
      format,
      events: result.checkedEvents,
      bytes: Buffer.byteLength(input),
      elapsedMs: Math.round(performance.now() - before),
      heapMiB: Math.round(process.memoryUsage().heapUsed / 1024 ** 2),
    }),
  );
} else {
  for (const format of formats) {
    const run = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=256",
        fileURLToPath(import.meta.url),
        "--worker",
        format,
      ],
      { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    if (run.error) throw run.error;
    assert.equal(run.status, 0, run.stderr);
    process.stdout.write(run.stdout);
  }
}
