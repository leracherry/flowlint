import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createLintSession, parseTraceStream } from "../dist/index.js";
const workloads = ["raw", "history", "patches", "agents"];
function* events(workload) {
  if (workload === "history") {
    for (let i = 0; i < 3000; i++) {
      const threadId = `t${i % 10}`,
        runId = `r${i}`;
      yield { type: "RUN_STARTED", threadId, runId };
      yield { type: "TEXT_MESSAGE_START", messageId: `m${i}` };
      yield { type: "TEXT_MESSAGE_END", messageId: `m${i}` };
      yield { type: "RUN_FINISHED", threadId, runId };
    }
    return;
  }
  yield { type: "RUN_STARTED", threadId: "t", runId: "r" };
  if (workload === "agents") {
    for (let base = 0; base < 1000; base += 20) {
      for (let i = base; i < base + 20; i++) {
        const subagentRunId = `a${i}`;
        yield { type: "SUBAGENT_STARTED", subagentRunId, name: "worker" };
        yield { type: "STEP_STARTED", subagentRunId, stepName: "work" };
        yield { type: "TEXT_MESSAGE_START", subagentRunId, messageId: `m${i}` };
      }
      for (let i = base + 19; i >= base; i--) {
        const subagentRunId = `a${i}`;
        yield { type: "TEXT_MESSAGE_END", subagentRunId, messageId: `m${i}` };
        yield { type: "STEP_FINISHED", subagentRunId, stepName: "work" };
        yield { type: "SUBAGENT_FINISHED", subagentRunId };
      }
    }
    yield { type: "RUN_FINISHED", threadId: "t", runId: "r" };
    return;
  }
  if (workload === "patches")
    yield { type: "STATE_SNAPSHOT", snapshot: { value: 0 } };
  for (let i = 0; i < 25000; i++)
    yield workload === "raw"
      ? { type: "RAW", event: { i, text: "x".repeat(100) } }
      : {
          type: "STATE_DELTA",
          delta: [{ op: "replace", path: "/value", value: i }],
        };
  yield { type: "RUN_FINISHED", threadId: "t", runId: "r" };
}
if (process.argv[2] === "--worker") {
  const [format, workload] = process.argv.slice(3);
  assert(["ndjson", "sse"].includes(format) && workloads.includes(workload));
  let supplied = 0,
    bytes = 0;
  async function* chunks() {
    for (const event of events(workload)) {
      const chunk = Buffer.from(
        format === "sse"
          ? `data: ${JSON.stringify(event)}\n\n`
          : JSON.stringify(event) + "\n",
      );
      supplied++;
      bytes += chunk.length;
      yield chunk;
    }
  }
  const session = createLintSession();
  const before = performance.now();
  for await (const record of parseTraceStream(chunks(), { format }))
    session.push(record);
  const result = session.finish();
  assert.equal(result.checkedEvents, supplied);
  assert.deepEqual(result.diagnostics, []);
  console.log(
    JSON.stringify({
      format,
      workload,
      events: supplied,
      bytes,
      elapsedMs: Math.round(performance.now() - before),
      heapMiB: Math.round(process.memoryUsage().heapUsed / 1024 ** 2),
      peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    }),
  );
} else {
  for (const format of ["ndjson", "sse"])
    for (const workload of workloads) {
      const run = spawnSync(
        process.execPath,
        [
          "--max-old-space-size=256",
          fileURLToPath(import.meta.url),
          "--worker",
          format,
          workload,
        ],
        { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      if (run.error) throw run.error;
      assert.equal(run.status, 0, run.stderr);
      process.stdout.write(run.stdout);
    }
}
