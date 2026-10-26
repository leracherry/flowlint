import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  getReproFindings,
  minimizeTrace,
  parseTrace,
  lintEvents,
} from "../src/index";
import type { Reproducer } from "../src/index";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const text = (extra = {}) => ({
  type: "TEXT_MESSAGE_START",
  messageId: "m",
  ...extra,
});
const end = { type: "TEXT_MESSAGE_END", messageId: "m" };
const tool = (extra = {}) => ({
  type: "TOOL_CALL_START",
  toolCallId: "c",
  toolCallName: "search",
  ...extra,
});
const toolEnd = { type: "TOOL_CALL_END", toolCallId: "c" };
const records = (events: unknown[]) =>
  parseTrace(events.map((e) => JSON.stringify(e)).join("\n"));
const noise = Array.from({ length: 20 }, (_, i) => ({
  type: "RAW",
  event: { i, payload: "private noise" },
}));
function rebase(result: Reproducer) {
  return result.validation.diagnostics.map((d) => ({
    ...d,
    eventIndex:
      d.eventIndex === undefined
        ? undefined
        : result.mapping[d.eventIndex]!.original.eventIndex,
    related: d.related?.map((r) => ({
      ...r,
      eventIndex: result.mapping[r.eventIndex]!.original.eventIndex,
    })),
  }));
}
const cases: [string, unknown[]][] = [
  ["FL008", [start, ...noise, text(), text(), end, finish]],
  [
    "FL002",
    [
      start,
      ...noise,
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "x" },
      end,
      finish,
    ],
  ],
  ["FL002", [start, ...noise, end, finish]],
  ["FL004", [start, ...noise, tool(), tool(), toolEnd, finish]],
  [
    "FL005",
    [
      start,
      ...noise,
      { type: "TOOL_CALL_ARGS", toolCallId: "c", delta: "x" },
      toolEnd,
      finish,
    ],
  ],
  ["FL005", [start, ...noise, toolEnd, finish]],
  ["FL006", [start, ...noise, { ...start, runId: "other" }, finish]],
  ["FL007", [start, ...noise, finish, start, finish]],
  ["RUN_IDENTITY", [start, ...noise, { ...finish, runId: "wrong" }, finish]],
  ["RUN_TRANSITION", [start, ...noise, finish, end]],
  [
    "ITEM_REOPEN",
    [
      start,
      ...noise,
      text({ name: "old" }),
      end,
      text({ name: "new" }),
      end,
      finish,
    ],
  ],
  [
    "ITEM_REOPEN",
    [
      start,
      ...noise,
      tool({ parentMessageId: "m" }),
      toolEnd,
      tool(),
      toolEnd,
      finish,
    ],
  ],
];
it.each(cases)(
  "reduces an eligible %s case and preserves its original cause",
  async (rule, events) => {
    const input = records(events);
    const finding = getReproFindings(input).find(
      (f) => f.diagnostic.ruleId === rule,
    )!;
    expect(finding.supported).toBe(true);
    const result = await minimizeTrace(input, { findingId: finding.id });
    expect(result.changed).toBe(true);
    expect(result.stats.removedEvents).toBeGreaterThanOrEqual(noise.length);
    expect(result.stopReason).toBe("complete");
    const target = rebase(result).find(
      (d) =>
        d.ruleId === rule && d.eventIndex === finding.diagnostic.eventIndex,
    )!;
    expect(target.message).toBe(finding.diagnostic.message);
    expect(target.severity).toBe(finding.diagnostic.severity);
    expect(target.context).toEqual(finding.diagnostic.context);
    expect(target.related?.map((r) => r.eventIndex)).toEqual(
      finding.diagnostic.related?.map((r) => r.eventIndex),
    );
    for (const d of rebase(result))
      expect(
        getReproFindings(input).some(
          (f) =>
            f.diagnostic.ruleId === d.ruleId &&
            f.diagnostic.eventIndex === d.eventIndex &&
            f.diagnostic.message === d.message,
        ),
      ).toBe(true);
    expect(result.outputSha256).toBe(
      createHash("sha256").update(result.ndjson).digest("hex"),
    );
    expect(result.validation).toEqual(lintEvents(parseTrace(result.ndjson)));
    for (const record of parseTrace(result.ndjson)) {
      const sourceIndex =
        result.mapping[record.eventIndex]!.original.eventIndex;
      expect(record.event).toEqual(
        input.find((r) => r.eventIndex === sourceIndex)!.event,
      );
    }
  },
);
it("preserves snapshot-established evidence in a recorded producer journey", async () => {
  const input = parseTrace(
    readFileSync(
      "test/fixtures/producers/langgraphFastAPITests-deepagentsSubagentsPage-approvesSubagentAnswer.ndjson",
      "utf8",
    ),
  );
  const finding = getReproFindings(input).find(
    (f) => f.diagnostic.ruleId === "ITEM_REOPEN",
  )!;
  const result = await minimizeTrace(input, { findingId: finding.id });
  expect(result.changed).toBe(true);
  expect(result.pinnedOriginalIndices).toContain(35);
  expect(
    rebase(result).find((d) => d.eventIndex === finding.diagnostic.eventIndex)
      ?.related?.[0]?.eventIndex,
  ).toBe(35);
});
it("keeps the original opener instead of substituting a different duplicate cause", async () => {
  const input = records([start, ...noise, text(), text(), text(), end, finish]);
  const finding = getReproFindings(input)
    .filter((f) => f.diagnostic.ruleId === "FL008")
    .at(-1)!;
  const result = await minimizeTrace(input, { findingId: finding.id });
  const originalIndices = result.mapping.map((m) => m.original.eventIndex);
  expect(originalIndices).toEqual(expect.arrayContaining([21, 22, 23]));
  expect(rebase(result).filter((d) => d.ruleId === "FL008")).toHaveLength(2);
});
it("does not create new lifecycle errors while deleting unrelated entities", async () => {
  const input = records([
    start,
    ...noise,
    text({ messageId: "unrelated" }),
    { type: "TEXT_MESSAGE_END", messageId: "unrelated" },
    tool(),
    tool(),
    toolEnd,
    finish,
  ]);
  const finding = getReproFindings(input).find(
    (f) => f.diagnostic.ruleId === "FL004",
  )!;
  const result = await minimizeTrace(input, { findingId: finding.id });
  expect(result.validation.diagnostics.map((d) => d.ruleId)).toEqual(["FL004"]);
});
it("honestly reports unchanged when all retained events are dependencies", async () => {
  const input = records([start, text(), text(), end, finish]);
  const result = await minimizeTrace(input, {
    findingId: getReproFindings(input)[0]!.id,
  });
  expect(result.changed).toBe(false);
  expect(result.stats.checks).toBe(0);
});
it("binds finding identities to the input and capture mode", () => {
  const input = records([start, ...noise, end, finish]);
  const id = getReproFindings(input)[0]!.id;
  expect(id).toBe(getReproFindings(input)[0]!.id);
  expect(getReproFindings(input, { allowPartial: true })[0]!.id).not.toBe(id);
  expect(
    getReproFindings(records([start, ...noise.slice(1), end, finish]))[0]!.id,
  ).not.toBe(id);
  expect(getReproFindings([])).toEqual([]);
});
it.each([
  { type: "TEXT_MESSAGE_CHUNK", messageId: "chunk", delta: "x" },
  { type: "STATE_DELTA", delta: [] },
  {
    type: "REASONING_ENCRYPTED_VALUE",
    subtype: "message",
    entityId: "m",
    encryptedValue: "opaque",
  },
])(
  "declines unsupported context without claiming to reduce it: %j",
  async (event) => {
    const input = records([
      start,
      ...noise,
      event,
      text(),
      text(),
      end,
      finish,
    ]);
    const finding = getReproFindings(input).find(
      (f) => f.diagnostic.ruleId === "FL008",
    )!;
    expect(finding.supported).toBe(false);
    const result = await minimizeTrace(input, { findingId: finding.id });
    expect(result.stopReason).toBe("unsupported");
    expect(result.changed).toBe(false);
    expect(result.stats.checks).toBe(0);
  },
);
it("retains the best verified candidate on check limits and cancellation", async () => {
  const input = records(cases[0]![1]);
  const findingId = getReproFindings(input)[0]!.id;
  const limited = await minimizeTrace(input, { findingId, maxChecks: 1 });
  expect(limited.stopReason).toBe("check-limit");
  expect(limited.stats.checks).toBe(1);
  expect(limited.changed).toBe(true);
  const controller = new AbortController();
  const cancelled = await minimizeTrace(input, {
    findingId,
    signal: controller.signal,
    onProgress: () => controller.abort(),
  });
  expect(cancelled.stopReason).toBe("cancelled");
  expect(
    cancelled.validation.diagnostics.some((d) => d.ruleId === "FL008"),
  ).toBe(true);
});
it("observes a cooperative time budget and pre-aborted signals", async () => {
  const input = records(cases[0]![1]);
  const findingId = getReproFindings(input)[0]!.id;
  const result = await minimizeTrace(input, {
    findingId,
    maxDurationMs: 1,
    onProgress() {
      const until = performance.now() + 5;
      while (performance.now() < until) {
        /* exhaust time budget */
      }
    },
  });
  expect(result.stopReason).toBe("time-limit");
  const controller = new AbortController();
  controller.abort();
  expect(
    (await minimizeTrace(input, { findingId, signal: controller.signal }))
      .stopReason,
  ).toBe("cancelled");
});
it("rejects stale finding IDs and invalid source identities or budgets", async () => {
  const input = records(cases[0]![1]);
  const findingId = getReproFindings(input)[0]!.id;
  await expect(
    minimizeTrace(input, { findingId: "missing" }),
  ).rejects.toMatchObject({ code: "REPRO_FINDING" });
  await expect(
    minimizeTrace(input, { findingId, maxChecks: 0 }),
  ).rejects.toThrow(RangeError);
  await expect(
    minimizeTrace(input, { findingId, maxDurationMs: 0 }),
  ).rejects.toThrow(RangeError);
  expect(() => getReproFindings([input[0]!, input[0]!])).toThrow();
});
it("preserves partial capture policy and source coordinates after serialization", async () => {
  const input = records([{ type: "RAW", event: {} }, ...noise, end]);
  const finding = getReproFindings(input, { allowPartial: true }).find(
    (f) => f.diagnostic.ruleId === "FL002",
  )!;
  const result = await minimizeTrace(input, {
    findingId: finding.id,
    allowPartial: true,
  });
  expect(result.options.allowPartial).toBe(true);
  expect(rebase(result).find((d) => d.ruleId === "FL002")!.severity).toBe(
    "warning",
  );
});

it("does not redact retained payloads or mutate the input", async () => {
  const input = records([
    start,
    ...noise,
    text(),
    {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m",
      delta: "PRIVATE_RETAINED_BODY",
    },
    text(),
    end,
    finish,
  ]);
  const original = JSON.stringify(input);
  const finding = getReproFindings(input).find(
    (f) => f.diagnostic.ruleId === "FL008",
  )!;
  const result = await minimizeTrace(input, { findingId: finding.id });
  expect(result.ndjson).toContain("PRIVATE_RETAINED_BODY");
  expect(result.ndjson).not.toContain("private noise");
  expect(JSON.stringify(input)).toBe(original);
});
it("does not reduce encrypted artifacts supplied through recorded history", async () => {
  const input = records([
    start,
    {
      type: "MESSAGES_SNAPSHOT",
      messages: [
        {
          id: "history",
          role: "assistant",
          content: "",
          encryptedValue: "opaque",
        },
      ],
    },
    ...noise,
    text(),
    text(),
    end,
    finish,
  ]);
  const finding = getReproFindings(input).find(
    (f) => f.diagnostic.ruleId === "FL008",
  )!;
  expect(finding.supported).toBe(false);
  expect(
    (await minimizeTrace(input, { findingId: finding.id })).stopReason,
  ).toBe("unsupported");
});
it("rejects cyclic caller input without serialization crashes", () => {
  const event: Record<string, unknown> = { type: "RAW" };
  event.event = event;
  expect(() =>
    getReproFindings([{ event, eventIndex: 0, line: 1, column: 1 }]),
  ).toThrow("Reproducer events exceed input limits");
});

it("handles long pinned entity histories without repeatedly expanding dependencies", async () => {
  const input = records([
    start,
    text(),
    ...Array.from({ length: 3000 }, () => ({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m",
      delta: "x",
    })),
    text(),
    end,
    finish,
  ]);
  const finding = getReproFindings(input).find(
    (f) => f.diagnostic.ruleId === "FL008",
  )!;
  const result = await minimizeTrace(input, { findingId: finding.id });
  expect(result.changed).toBe(false);
  expect(result.stats.checks).toBe(0);
  expect(result.mapping).toHaveLength(input.length);
});

it("rejects oversized serialized inputs before joining the whole trace", () => {
  const event = { type: "RAW", event: "x".repeat(5 * 1024 * 1024) };
  expect(() =>
    getReproFindings([
      { event, eventIndex: 0, line: 1, column: 1 },
      { event, eventIndex: 1, line: 2, column: 1 },
    ]),
  ).toThrow("serialization exceeds the 10 MiB");
});

it.each(
  [NaN, Infinity, -0, undefined, new Date(0), [undefined], Array(2)].map(
    (value) => ({ value }),
  ),
)(
  "rejects values JSON serialization would silently change: %j",
  ({ value }) => {
    expect(() =>
      getReproFindings([
        {
          event: { type: "RAW", event: value },
          eventIndex: 0,
          line: 1,
          column: 1,
        },
      ]),
    ).toThrow("plain JSON values");
  },
);

it("returns an unchanged verified result for rules without a dependency model", async () => {
  const input = records([start, ...noise]);
  const finding = getReproFindings(input).find(
    (f) => f.diagnostic.ruleId === "FL012",
  )!;
  expect(finding.supported).toBe(false);
  const result = await minimizeTrace(input, { findingId: finding.id });
  expect(result.stopReason).toBe("unsupported");
  expect(result.changed).toBe(false);
  expect(result.outputSha256).toBe(result.inputSha256);
});

it("retains parent and result ownership dependencies across an item-kind reopening", async () => {
  const input = records([
    start,
    ...noise,
    {
      type: "TEXT_MESSAGE_START",
      messageId: "parent",
      subagentRunId: "worker",
    },
    { type: "TEXT_MESSAGE_END", messageId: "parent" },
    tool({ parentMessageId: "parent" }),
    toolEnd,
    {
      type: "TOOL_CALL_RESULT",
      toolCallId: "c",
      messageId: "result",
      content: "result body",
    },
    { type: "TEXT_MESSAGE_START", messageId: "result", role: "assistant" },
    { type: "TEXT_MESSAGE_END", messageId: "result" },
    finish,
  ]);
  const finding = getReproFindings(input).find(
    (f) => f.diagnostic.ruleId === "ITEM_REOPEN",
  )!;
  const result = await minimizeTrace(input, { findingId: finding.id });
  expect(result.pinnedOriginalIndices).toEqual(
    expect.arrayContaining([21, 22, 23, 24, 25, 26, 27]),
  );
  expect(result.changed).toBe(true);
  expect(
    rebase(result).find((d) => d.ruleId === "ITEM_REOPEN")!.context?.fields,
  ).toEqual(["role"]);
});
