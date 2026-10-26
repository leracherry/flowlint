import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { compareTraces, parseTrace } from "../dist/index.js";
const workloads = ["concurrency", "threads", "fragments"];
if (process.argv[2] === "--worker") {
  const workload = process.argv[3];
  assert(workloads.includes(workload));
  const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
  const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
  const events =
    workload === "threads"
      ? Array.from({ length: 2000 }, (_, i) => [
          {
            ...start,
            threadId: `t${i}`,
            input: {
              threadId: `t${i}`,
              runId: "r",
              state: { i },
              messages: [],
              tools: [],
              context: [],
              forwardedProps: {},
            },
          },
          { ...finish, threadId: `t${i}` },
        ]).flat()
      : workload === "concurrency"
        ? [
            start,
            ...Array.from({ length: 10000 }, (_, i) => ({
              type: "TOOL_CALL_START",
              toolCallId: `tool${i}`,
              toolCallName: `name${i}`,
            })),
            ...Array.from({ length: 10000 }, (_, i) => ({
              type: "TOOL_CALL_END",
              toolCallId: `tool${i}`,
            })),
            finish,
          ]
        : [
            start,
            { type: "TEXT_MESSAGE_START", messageId: "m" },
            ...Array.from({ length: 25000 }, () => ({
              type: "TEXT_MESSAGE_CONTENT",
              messageId: "m",
              delta: "x".repeat(100),
            })),
            { type: "TEXT_MESSAGE_END", messageId: "m" },
            finish,
          ];
  const records = parseTrace(JSON.stringify(events));
  const before = performance.now();
  const result = compareTraces(records, records);
  assert.equal(result.status, "equal", JSON.stringify(result.issues));
  assert.equal(result.differenceCount, 0);
  if (workload === "threads") assert.equal(result.states.before.length, 2000);
  if (workload === "concurrency") assert(result.mappings.beforeOmitted > 0);
  if (workload === "fragments")
    assert.equal(result.summary.beforeCanonicalEvents, 5);
  console.log(
    JSON.stringify({
      workload,
      events: events.length,
      elapsedMs: Math.round(performance.now() - before),
      heapMiB: Math.round(process.memoryUsage().heapUsed / 1024 ** 2),
    }),
  );
} else {
  for (const workload of workloads) {
    const run = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=256",
        fileURLToPath(import.meta.url),
        "--worker",
        workload,
      ],
      { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    if (run.error) throw run.error;
    assert.equal(run.status, 0, run.stderr);
    process.stdout.write(run.stdout);
  }
}
