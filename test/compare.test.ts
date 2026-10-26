import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { compareTraces, parseTrace, lintEvents } from "../src/index";
import { StatePatches } from "../src/state-patches";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const text = (id = "m", extra = {}) => ({
  type: "TEXT_MESSAGE_START",
  messageId: id,
  ...extra,
});
const content = (delta: string, messageId = "m", extra = {}) => ({
  type: "TEXT_MESSAGE_CONTENT",
  messageId,
  delta,
  ...extra,
});
const end = (messageId = "m") => ({ type: "TEXT_MESSAGE_END", messageId });
const records = (events: unknown[]) => parseTrace(JSON.stringify(events));
const chat = [start, text(), content("hello"), end(), finish];
function rename(events: unknown[]): unknown[] {
  return events.map((value) => {
    const event = { ...(value as Record<string, unknown>) };
    for (const key of [
      "threadId",
      "runId",
      "messageId",
      "toolCallId",
      "parentMessageId",
      "subagentRunId",
      "parentSubagentRunId",
    ])
      if (typeof event[key] === "string") event[key] = "new-" + event[key];
    return event;
  });
}
it("treats consistent generated ID renaming and top-level timestamps as equal", () => {
  const before = records(chat.map((e, i) => ({ ...e, timestamp: i })));
  const after = records(
    rename(chat).map((e, i) => ({ ...(e as object), timestamp: i + 1000 })),
  );
  const result = compareTraces(before, after);
  expect(result.status).toBe("equal");
  expect(result.differenceCount).toBe(0);
  expect(
    result.mappings.before.some((m) => m.kind === "message" && m.id === "m"),
  ).toBe(true);
  expect(
    result.mappings.after.some((m) => m.kind === "message" && m.id === "new-m"),
  ).toBe(true);
});
it("merges adjacent text fragments without losing terminal events", () => {
  expect(
    compareTraces(
      records(chat),
      records([
        start,
        text(),
        content("he"),
        content(""),
        content("llo"),
        end(),
        finish,
      ]),
    ).status,
  ).toBe("equal");
  const result = compareTraces(records(chat), records(chat.slice(0, -1)));
  expect(result.status).toBe("changed");
  expect(result.protocol.after.diagnostics.map((d) => d.ruleId)).toContain(
    "FL012",
  );
  expect(
    result.differences.some(
      (d) => d.before?.type === "RUN_FINISHED" && !d.after,
    ),
  ).toBe(true);
});
it("does not merge text across observable events or metadata changes", () => {
  const interleaved = [
    start,
    text(),
    content("he"),
    { type: "RAW", event: { marker: true } },
    content("llo"),
    end(),
    finish,
  ];
  const moved = [
    start,
    text(),
    content("hello"),
    { type: "RAW", event: { marker: true } },
    end(),
    finish,
  ];
  expect(compareTraces(records(interleaved), records(moved)).status).toBe(
    "changed",
  );
  expect(
    compareTraces(
      records(chat),
      records([
        start,
        text(),
        content("he", "m", { metadata: { step: 1 } }),
        content("llo"),
        end(),
        finish,
      ]),
    ).status,
  ).toBe("changed");
});
it("normalizes valid text chunk shorthand against explicit message streaming", () => {
  const chunks = [
    start,
    { type: "TEXT_MESSAGE_CHUNK", messageId: "m", delta: "he" },
    { type: "TEXT_MESSAGE_CHUNK", delta: "llo" },
    finish,
  ];
  const result = compareTraces(records(chat), records(chunks));
  expect(result.protocol.after.valid).toBe(true);
  expect(result.status).toBe("equal");
});
it("compares parent/tool relationships and argument rechunking", () => {
  const input = [
    start,
    text(),
    end(),
    {
      type: "TOOL_CALL_START",
      toolCallId: "c",
      toolCallName: "search",
      parentMessageId: "m",
    },
    { type: "TOOL_CALL_ARGS", toolCallId: "c", delta: "ab" },
    { type: "TOOL_CALL_END", toolCallId: "c" },
    finish,
  ];
  const renamed = rename(input);
  expect(compareTraces(records(input), records(renamed)).status).toBe("equal");
  const fragments = [
    ...input.slice(0, 4),
    { type: "TOOL_CALL_ARGS", toolCallId: "c", delta: "a" },
    { type: "TOOL_CALL_ARGS", toolCallId: "c", delta: "b" },
    ...input.slice(5),
  ];
  expect(compareTraces(records(input), records(fragments)).status).toBe(
    "equal",
  );
  const changed = structuredClone(input);
  Object.assign(changed[3]!, { parentMessageId: "other" });
  expect(compareTraces(records(input), records(changed)).status).toBe(
    "changed",
  );
});
it("detects tool ownership changes between distinguishable declared agents", () => {
  const input = [
    start,
    { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "planner" },
    { type: "SUBAGENT_STARTED", subagentRunId: "b", name: "researcher" },
    {
      type: "TOOL_CALL_START",
      toolCallId: "c",
      toolCallName: "search",
      subagentRunId: "a",
    },
    { type: "TOOL_CALL_END", toolCallId: "c" },
    { type: "SUBAGENT_FINISHED", subagentRunId: "a" },
    { type: "SUBAGENT_FINISHED", subagentRunId: "b" },
    finish,
  ];
  const changed = structuredClone(input);
  Object.assign(changed[3]!, { subagentRunId: "b" });
  const result = compareTraces(records(input), records(changed));
  expect(result.protocol.before.valid).toBe(true);
  expect(result.protocol.after.valid).toBe(true);
  expect(result.status).toBe("changed");
  expect(
    result.differences.some((d) => d.fields.includes("subagentRunId")),
  ).toBe(true);
});
it("compares inherited and explicit matching owner tags equally", () => {
  const input = [
    start,
    text("m", { subagentRunId: "a" }),
    content("hello"),
    end(),
    finish,
  ];
  const explicit = [
    start,
    text("m", { subagentRunId: "a" }),
    content("hello", "m", { subagentRunId: "a" }),
    { ...end(), subagentRunId: "a" },
    finish,
  ];
  expect(compareTraces(records(input), records(explicit)).status).toBe("equal");
});
it("marks indistinguishable concurrent messages as incomparable", () => {
  const input = [
    start,
    text("a"),
    text("b"),
    content("one", "a"),
    content("two", "b"),
    end("a"),
    end("b"),
    finish,
  ];
  const result = compareTraces(records(input), records(rename(input)));
  expect(result.protocol.before.valid).toBe(true);
  expect(result.status).toBe("incomparable");
  expect(result.issues.some((i) => i.code === "ambiguous-entities")).toBe(true);
});
it("does not reorder distinguishable concurrent entities to manufacture equality", () => {
  const input = [
    start,
    text("a", { name: "one" }),
    text("b", { name: "two" }),
    end("a"),
    end("b"),
    finish,
  ];
  const reordered = [
    input[0],
    input[2],
    input[1],
    input[3],
    input[4],
    input[5],
  ];
  expect(compareTraces(records(input), records(reordered)).status).toBe(
    "changed",
  );
});
it("normalizes known history references while preserving opaque data literally", () => {
  const history = [
    {
      id: "old",
      role: "assistant",
      content: "hello",
      toolCalls: [
        {
          id: "c",
          type: "function",
          function: { name: "search", arguments: "{}" },
        },
      ],
    },
  ];
  const input = [
    start,
    { type: "MESSAGES_SNAPSHOT", messages: history },
    {
      type: "TOOL_CALL_START",
      toolCallId: "c",
      toolCallName: "search",
      parentMessageId: "old",
    },
    { type: "TOOL_CALL_END", toolCallId: "c" },
    finish,
  ];
  const changed = rename(input) as Record<string, unknown>[];
  changed[1]!.messages = [
    {
      ...history[0],
      id: "new-old",
      toolCalls: [{ ...history[0]!.toolCalls[0], id: "new-c" }],
    },
  ];
  expect(compareTraces(records(input), records(changed)).status).toBe("equal");
  expect(
    compareTraces(
      records([start, { type: "RAW", event: { messageId: "m" } }, finish]),
      records([start, { type: "RAW", event: { messageId: "new-m" } }, finish]),
    ).status,
  ).toBe("changed");
});
it("compares state outcomes without depending on object key order", () => {
  const input = [
    start,
    { type: "STATE_SNAPSHOT", snapshot: { a: 1, b: 2 } },
    { type: "STATE_DELTA", delta: [{ op: "replace", path: "/a", value: 3 }] },
    finish,
  ];
  const reordered = [
    start,
    { type: "STATE_SNAPSHOT", snapshot: { b: 2, a: 1 } },
    input[2],
    finish,
  ];
  const equal = compareTraces(records(input), records(reordered));
  expect(equal.status).toBe("equal");
  expect(equal.states.before[0]).toMatchObject({ status: "known" });
  expect(equal.states.before).toEqual(equal.states.after);
  const changed = structuredClone(input);
  Object.assign(changed[1]!, { snapshot: { a: 1, b: 9 } });
  const result = compareTraces(records(input), records(changed));
  expect(result.status).toBe("changed");
  expect(result.differences.some((d) => d.kind === "state")).toBe(true);
});
it("preserves intermediate state changes even if final state matches", () => {
  const a = [
    start,
    { type: "STATE_SNAPSHOT", snapshot: { a: 1 } },
    { type: "STATE_SNAPSHOT", snapshot: { a: 3 } },
    finish,
  ];
  const b = [
    start,
    { type: "STATE_SNAPSHOT", snapshot: { a: 2 } },
    a[2],
    finish,
  ];
  const result = compareTraces(records(a), records(b));
  expect(result.status).toBe("changed");
  expect(result.states.before).toEqual(result.states.after);
});
it.each([
  [{ type: "STATE_DELTA", delta: [{ op: "replace", path: "/x", value: 1 }] }],
  [{ type: "ACTIVITY_DELTA", messageId: "a", patch: [] }],
  [
    {
      type: "REASONING_ENCRYPTED_VALUE",
      subtype: "message",
      entityId: "m",
      encryptedValue: "opaque",
    },
  ],
])("marks unavailable state or opaque histories as incomparable", (extra) => {
  const input = records([start, extra, finish]);
  const result = compareTraces(input, input);
  expect(result.status).toBe("incomparable");
  expect(result.issues.length).toBeGreaterThan(0);
});
it("never claims equivalence for matching invalid traces", () => {
  const input = records([start, end(), finish]);
  expect(compareTraces(input, input).status).toBe("incomparable");
  expect(compareTraces(input, input).protocol.before).toEqual(
    lintEvents(input),
  );
});
it("reports partial boundary uncertainty and preserves protocol results separately", () => {
  const input = records([start, text(), content("x")]);
  const result = compareTraces(input, input, { allowPartial: true });
  expect(result.status).toBe("incomparable");
  expect(result.protocol.before.valid).toBe(true);
  expect(result.issues.some((i) => i.code === "partial-boundary")).toBe(true);
});
it("does not compare timing or discard nested timestamp metadata", () => {
  const a = records([
    start,
    { type: "CUSTOM", name: "metrics", value: { timestamp: 1 } },
    finish,
  ]);
  const b = records([
    start,
    { type: "CUSTOM", name: "metrics", value: { timestamp: 2 } },
    finish,
  ]);
  expect(compareTraces(a, b).status).toBe("changed");
});
it("bounds differences and mapping labels while still detecting all changed events", () => {
  const a = records([
    start,
    ...Array.from({ length: 20 }, (_, i) => ({ type: "RAW", event: i })),
    finish,
  ]);
  const b = records([
    start,
    ...Array.from({ length: 20 }, (_, i) => ({ type: "RAW", event: i + 100 })),
    finish,
  ]);
  const result = compareTraces(a, b, { maxDifferences: 2 });
  expect(result.differenceCount).toBe(20);
  expect(result.differences).toHaveLength(2);
  expect(result.differencesOmitted).toBe(18);
  expect(JSON.stringify(result.differences)).not.toContain("100");
  const long = records([
    start,
    text("x".repeat(300)),
    end("x".repeat(300)),
    finish,
  ]);
  expect(
    compareTraces(long, long).mappings.before.some((m) => m.shortened),
  ).toBe(true);
});
it("scopes messages by thread and agents by run", () => {
  const input = [
    start,
    text(),
    end(),
    finish,
    { ...start, threadId: "other", runId: "next" },
    text(),
    end(),
    { ...finish, threadId: "other", runId: "next" },
  ];
  const result = compareTraces(records(input), records(rename(input)));
  expect(result.status).toBe("equal");
  expect(
    new Set(
      result.mappings.before
        .filter((m) => m.kind === "message")
        .map((m) => m.scope),
    ).size,
  ).toBe(2);
});
it("rejects unsupported policies and invalid bounds", () => {
  const input = records(chat);
  expect(() =>
    compareTraces(input, input, { policy: "unknown" as "adapter-upgrade/v1" }),
  ).toThrow();
  for (const maxDifferences of [0, -1, NaN, 1001])
    expect(() => compareTraces(input, input, { maxDifferences })).toThrow(
      RangeError,
    );
});
it("returns detached state snapshots without changing patch validation", () => {
  const state = new StatePatches(() => {});
  for (const record of records([
    start,
    { type: "STATE_SNAPSHOT", snapshot: { a: 1 } },
  ]))
    state.observe(
      record.event as Parameters<StatePatches["observe"]>[0],
      record,
    );
  const first = state.snapshots();
  (first[0]!.value as Record<string, unknown>).a = 100;
  expect(state.snapshots()[0]!.value).toEqual({ a: 1 });
});
for (const file of readdirSync("test/fixtures/producers").filter((f) =>
  f.endsWith(".ndjson"),
))
  it(`compares recorded corpus without false changes: ${file}`, () => {
    const input = parseTrace(
      readFileSync("test/fixtures/producers/" + file, "utf8"),
    );
    const result = compareTraces(input, input);
    expect(["equal", "incomparable"]).toContain(result.status);
    expect(result.differenceCount).toBe(0);
    if (result.status === "incomparable")
      expect(result.issues.length).toBeGreaterThan(0);
  });

it("keeps reasoning spans separate from message identity", () => {
  const a = [
    start,
    { type: "REASONING_START", messageId: "same" },
    { type: "REASONING_END", messageId: "same" },
    text("same"),
    end("same"),
    finish,
  ];
  const b = [
    start,
    { type: "REASONING_START", messageId: "span-renamed" },
    { type: "REASONING_END", messageId: "span-renamed" },
    text("message-renamed"),
    end("message-renamed"),
    finish,
  ];
  expect(compareTraces(records(a), records(b)).status).toBe("equal");
});
it("maps parent agent references independently of object property order", () => {
  const a = [
    start,
    { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "parent" },
    {
      type: "SUBAGENT_STARTED",
      subagentRunId: "b",
      parentSubagentRunId: "a",
      name: "child",
    },
    { type: "SUBAGENT_FINISHED", subagentRunId: "b" },
    { type: "SUBAGENT_FINISHED", subagentRunId: "a" },
    finish,
  ];
  const b = rename(a) as Record<string, unknown>[];
  b[2] = {
    name: "child",
    parentSubagentRunId: "new-a",
    subagentRunId: "new-b",
    type: "SUBAGENT_STARTED",
  };
  expect(compareTraces(records(a), records(b)).status).toBe("equal");
});
it("maps interrupt/resume references across runs within a thread", () => {
  const a = [
    start,
    {
      ...finish,
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "i", reason: "confirm" }],
      },
    },
    {
      ...start,
      runId: "r2",
      input: {
        threadId: "t",
        runId: "r2",
        state: {},
        messages: [],
        tools: [],
        context: [],
        resume: [{ interruptId: "i", status: "resolved", value: true }],
      },
    },
    { ...finish, runId: "r2" },
  ];
  const b = rename(a) as Record<string, unknown>[];
  b[1]!.outcome = {
    type: "interrupt",
    interrupts: [{ id: "new-i", reason: "confirm" }],
  };
  b[2]!.input = {
    threadId: "new-t",
    runId: "new-r2",
    state: {},
    messages: [],
    tools: [],
    context: [],
    resume: [{ interruptId: "new-i", status: "resolved", value: true }],
  };
  const result = compareTraces(records(a), records(b));
  expect(result.protocol.before.valid).toBe(true);
  expect(result.status).toBe("equal");
});
it("declines ambiguous cross-run historical ownership", () => {
  const a = [
    start,
    finish,
    {
      ...start,
      runId: "r2",
      input: {
        threadId: "t",
        runId: "r2",
        state: {},
        messages: [
          { id: "old", role: "assistant", content: "", subagentRunId: "prior" },
        ],
        tools: [],
        context: [],
      },
    },
    { ...finish, runId: "r2" },
  ];
  const result = compareTraces(records(a), records(a));
  expect(result.status).toBe("incomparable");
  expect(result.issues.some((i) => i.code === "history-scope")).toBe(true);
});
it("collects final state once per thread across many run boundaries", () => {
  const a: unknown[] = [];
  for (let i = 0; i < 500; i++) {
    const threadId = `t${i % 2}`;
    a.push({ ...start, threadId, runId: `r${i}` });
    if (i < 2)
      a.push({ type: "STATE_SNAPSHOT", snapshot: { value: "x".repeat(1000) } });
    a.push({ ...finish, threadId, runId: `r${i}` });
  }
  const result = compareTraces(records(a), records(a));
  expect(result.status).toBe("equal");
  expect(result.states.before).toHaveLength(2);
  expect(result.states.before.every((s) => s.status === "known")).toBe(true);
});

it("compares a derived producer recording after renaming and rechunking", () => {
  const before = parseTrace(
    readFileSync(
      "test/fixtures/producers/awsStrandsTypescriptTests-agenticChatPage-agenticChatSendsAndReceivesAMessage.ndjson",
      "utf8",
    ),
  );
  // Rename known history/input references too, keeping the derived recording consistent.
  const derived = before.map((r) => {
    const event = rename([r.event])[0] as Record<string, unknown>;
    const renameHistory = (messages: Record<string, unknown>[]) =>
      messages.map((message) => ({
        ...message,
        id: "new-" + message.id,
        ...(Array.isArray(message.toolCalls)
          ? {
              toolCalls: message.toolCalls.map((tool) => ({
                ...tool,
                id: "new-" + tool.id,
              })),
            }
          : {}),
        ...(typeof message.toolCallId === "string"
          ? { toolCallId: "new-" + message.toolCallId }
          : {}),
      }));
    if (event.input) {
      const input = event.input as Record<string, unknown>;
      event.input = {
        ...input,
        threadId: "new-" + input.threadId,
        runId: "new-" + input.runId,
        messages: renameHistory(input.messages as Record<string, unknown>[]),
      };
    }
    if (Array.isArray(event.messages))
      event.messages = renameHistory(event.messages);
    return event;
  });
  const transformed = derived.flatMap((event) => {
    if (
      event.type !== "TEXT_MESSAGE_CONTENT" ||
      typeof event.delta !== "string" ||
      event.delta.length < 2
    )
      return [event];
    const split = Math.floor(event.delta.length / 2);
    return [
      { ...event, delta: event.delta.slice(0, split) },
      { ...event, delta: event.delta.slice(split) },
    ];
  });
  expect(compareTraces(before, records(transformed)).status).toBe("equal");
  const changed = structuredClone(transformed);
  changed.find((e) => e.type === "TEXT_MESSAGE_CONTENT")!.delta += "changed";
  expect(compareTraces(before, records(changed)).status).toBe("changed");
});
it("does not mutate input records or comparison options", () => {
  const input = records(chat);
  const original = structuredClone(input);
  const options = Object.freeze({ maxDifferences: 1 });
  compareTraces(input, input, options);
  expect(input).toEqual(original);
});

for (const [name, status] of [
  ["rechunked", "equal"],
  ["changed", "changed"],
  ["incomparable", "incomparable"],
])
  it(`demonstrates the packaged ${name} comparison example`, () => {
    const before = parseTrace(
      readFileSync("examples/compare-before.ndjson", "utf8"),
    );
    const after = parseTrace(
      readFileSync(`examples/compare-${name}.ndjson`, "utf8"),
    );
    expect(lintEvents(before).valid).toBe(true);
    expect(lintEvents(after).valid).toBe(true);
    expect(compareTraces(before, after).status).toBe(status);
  });
it("bounds retained mappings without changing internal correspondence", () => {
  const input = records([
    start,
    ...Array.from({ length: 2001 }, (_, i) => [
      text(`m${i}`),
      end(`m${i}`),
    ]).flat(),
    finish,
  ]);
  const result = compareTraces(input, input);
  expect(result.status).toBe("equal");
  expect(result.mappings.before).toHaveLength(2000);
  expect(result.mappings.beforeOmitted).toBe(3);
});
