import { expect, it } from "vitest";
import {
  lintEvents,
  parseTrace,
  TraceInputError,
  MAX_INPUT_BYTES,
} from "../src/index";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const lint = (events: unknown[]) =>
  lintEvents(parseTrace(JSON.stringify(events)));
function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
it.each(["json", "ndjson", "sse"] as const)(
  "rejects excessive nesting safely in %s",
  (format) => {
    const event =
      '{"type":"RAW","event":' +
      "[".repeat(10000) +
      "0" +
      "]".repeat(10000) +
      "}";
    const input =
      format === "json"
        ? `[${event}]`
        : format === "sse"
          ? `data: ${event}\n\n`
          : event;
    expect(() => parseTrace(input, { format })).toThrow(TraceInputError);
    try {
      parseTrace(input, { format });
    } catch (e) {
      expect(e).toMatchObject({ code: "PARSE_DEPTH", line: 1 });
    }
  },
);
it("accepts bounded nesting and ignores bracket characters inside escaped strings", () => {
  const event =
    '{"type":"RAW","event":' +
    "[".repeat(254) +
    '"[\\\"{]"' +
    "]".repeat(254) +
    "}";
  expect(parseTrace(event)).toHaveLength(1);
  expect(
    lintEvents(parseTrace(event)).diagnostics.every(
      (d) => d.ruleId !== "LIMIT_EVENT",
    ),
  ).toBe(true);
});
it("handles cyclic and wide caller-supplied events without recursion", () => {
  const cycle: Record<string, unknown> = { type: "RAW" };
  cycle.event = cycle;
  for (const event of [cycle, { type: "RAW", event: Array(100001).fill(0) }]) {
    const result = lintEvents([{ event, eventIndex: 0, line: 1, column: 1 }]);
    expect(result.diagnostics).toMatchObject([
      { ruleId: "LIMIT_EVENT", severity: "error" },
    ]);
  }
});
it("accepts shared references without mistaking them for cycles", () => {
  const shared = { a: 1 };
  const result = lintEvents(
    [start, { type: "RAW", event: [shared, shared] }, finish].map(
      (event, eventIndex) => ({
        event,
        eventIndex,
        line: eventIndex + 1,
        column: 1,
      }),
    ),
  );
  expect(result.diagnostics).toEqual([]);
});
it("bounds repeated aliases before they expand exponentially", () => {
  let graph: unknown = {};
  for (let i = 0; i < 40; i++) graph = [graph, graph];
  expect(
    lintEvents([
      {
        event: { type: "RAW", event: graph },
        eventIndex: 0,
        line: 1,
        column: 1,
      },
    ]).diagnostics[0]?.ruleId,
  ).toBe("LIMIT_EVENT");
});
it("counts UTF-8 bytes rather than characters at the input limit", () =>
  expect(() => parseTrace("é".repeat(MAX_INPUT_BYTES / 2 + 1))).toThrow(
    TraceInputError,
  ));
it("arbitrary malformed input produces only structured input errors", () => {
  const rng = random(0xface);
  const alphabet = '{}[],:"\\\r\n abc0129\u0000é😀';
  for (let trial = 0; trial < 500; trial++) {
    let text = "";
    for (let n = 0; n < 100; n++)
      text += alphabet[Math.floor(rng() * alphabet.length)];
    for (const format of ["json", "ndjson", "sse"] as const) {
      try {
        lintEvents(parseTrace(text, { format }));
      } catch (e) {
        expect(e).toBeInstanceOf(TraceInputError);
      }
    }
  }
});
it("random JSON values round-trip across encodings and line endings", () => {
  const rng = random(0xbeef);
  const value = (depth: number): unknown => {
    const n = Math.floor(rng() * 6);
    if (depth > 3 || n === 0) return Math.floor(rng() * 1000);
    if (n === 1) return null;
    if (n === 2) return 'é😀"\\{}\n';
    if (n === 3) return rng() > 0.5;
    if (n === 4) return [value(depth + 1), value(depth + 1)];
    return { "a/b": value(depth + 1), "~": value(depth + 1) };
  };
  for (let i = 0; i < 100; i++) {
    const events = [start, { type: "RAW", event: value(0) }, finish];
    for (const eol of ["\n", "\r\n", "\r"])
      for (const input of [
        JSON.stringify(events),
        events.map((e) => JSON.stringify(e)).join(eol),
        events.map((e) => `data: ${JSON.stringify(e)}${eol}${eol}`).join(""),
      ]) {
        const parsed = parseTrace(input);
        expect(parsed.map((r) => r.event)).toEqual(events);
        expect(lintEvents(parsed).diagnostics).toEqual([]);
      }
  }
});
it("random array patches agree with an independent array model for state and activity", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = random(seed);
    const items: number[] = [];
    const patch: unknown[] = [];
    for (let step = 0; step < 40; step++) {
      const op = items.length ? Math.floor(rng() * 6) : 0;
      const index = Math.floor(rng() * items.length);
      const number = Math.floor(rng() * 100);
      if (op === 0) {
        items.push(number);
        patch.push({ op: "add", path: "/items/-", value: number });
      } else if (op === 1) {
        items.splice(index, 1);
        patch.push({ op: "remove", path: `/items/${index}` });
      } else if (op === 2) {
        items[index] = number;
        patch.push({ op: "replace", path: `/items/${index}`, value: number });
      } else if (op === 3) {
        const [moved] = items.splice(index, 1);
        items.push(moved!);
        patch.push({ op: "move", from: `/items/${index}`, path: "/items/-" });
      } else if (op === 4) {
        items.push(items[index]!);
        patch.push({ op: "copy", from: `/items/${index}`, path: "/items/-" });
      } else
        patch.push({
          op: "test",
          path: `/items/${index}`,
          value: items[index],
        });
      patch.push({ op: "test", path: "/items", value: [...items] });
    }
    expect(
      lint([
        start,
        { type: "STATE_SNAPSHOT", snapshot: { items: [] } },
        { type: "STATE_DELTA", delta: patch },
        finish,
      ]).diagnostics,
    ).toEqual([]);
    expect(
      lint([
        start,
        {
          type: "ACTIVITY_SNAPSHOT",
          messageId: "a",
          activityType: "test",
          content: { items: [] },
        },
        { type: "ACTIVITY_DELTA", messageId: "a", activityType: "test", patch },
        finish,
      ]).diagnostics,
    ).toEqual([]);
  }
});
it("random interleaved chunk lanes remain equivalent to explicit messages", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = random(seed);
    const ids = Array.from({ length: 8 }, (_, i) => `m${i}`);
    const chunks: unknown[] = [start];
    const explicit: unknown[] = [start];
    for (const id of ids) {
      chunks.push({
        type: "TEXT_MESSAGE_CHUNK",
        messageId: id,
        subagentRunId: id,
        delta: "a",
      });
      explicit.push({
        type: "TEXT_MESSAGE_START",
        messageId: id,
        subagentRunId: id,
      });
    }
    for (let step = 0; step < 50; step++) {
      const id = ids[Math.floor(rng() * ids.length)];
      chunks.push({
        type: "TEXT_MESSAGE_CHUNK",
        subagentRunId: id,
        delta: "b",
      });
      explicit.push({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: id,
        subagentRunId: id,
        delta: "b",
      });
    }
    explicit.push(
      ...ids.map((id) => ({
        type: "TEXT_MESSAGE_END",
        messageId: id,
        subagentRunId: id,
      })),
      finish,
    );
    chunks.push(finish);
    expect(lint(explicit).diagnostics).toEqual([]);
    expect(lint(chunks).diagnostics).toEqual([]);
  }
});
it("failed patches consume the shared work budget and cannot bypass it", () => {
  const result = lint([
    start,
    { type: "STATE_SNAPSHOT", snapshot: { body: "x".repeat(1024 * 1024) } },
    ...Array.from({ length: 205 }, () => ({
      type: "STATE_DELTA",
      delta: [{ op: "remove", path: "/missing" }],
    })),
    finish,
  ]);
  expect(result.diagnostics.some((d) => d.ruleId === "STATE_LIMIT")).toBe(true);
  expect(result.diagnostics.at(-1)?.ruleId).toBe("STATE_BASELINE");
}, 20000);
it("caps diagnostics deterministically under malformed-event floods", () => {
  const result = lint(
    Array.from({ length: 5000 }, () => ({ type: "UNKNOWN" })),
  );
  expect(result.diagnostics).toHaveLength(1001);
  expect(result.diagnostics.at(-1)?.ruleId).toBe("LIMIT_DIAGNOSTICS");
});
it("bounds source location indexing for newline-heavy captures", () => {
  expect(() => parseTrace("\n".repeat(100000) + "{}")).toThrow(TraceInputError);
  try {
    parseTrace("\n".repeat(100000) + "{}");
  } catch (e) {
    expect(e).toMatchObject({ code: "PARSE_LINES", line: 100001 });
  }
});
it("rejects patch-generated nesting before recursive clone or serialization", () => {
  const subtree = JSON.parse("[".repeat(200) + "0" + "]".repeat(200));
  const initial = JSON.parse('{"x":'.repeat(100) + "{}" + "}".repeat(100));
  const path = "/x".repeat(100) + "/nested";
  const result = lint([
    start,
    { type: "STATE_SNAPSHOT", snapshot: initial },
    { type: "STATE_DELTA", delta: [{ op: "add", path, value: subtree }] },
    finish,
  ]);
  expect(result.diagnostics).toMatchObject([
    { ruleId: "STATE_LIMIT", severity: "warning" },
  ]);
});
it("bounds sparse array lengths before serialization or cloning", () => {
  const result = lintEvents([
    {
      event: { type: "STATE_SNAPSHOT", snapshot: new Array(2 ** 32 - 1) },
      eventIndex: 0,
      line: 1,
      column: 1,
    },
  ]);
  expect(result.diagnostics).toMatchObject([{ ruleId: "LIMIT_EVENT" }]);
});
it("bounds direct API string payloads before state serialization", () => {
  const result = lintEvents([
    {
      event: {
        type: "STATE_SNAPSHOT",
        snapshot: "x".repeat(MAX_INPUT_BYTES + 1),
      },
      eventIndex: 0,
      line: 1,
      column: 1,
    },
  ]);
  expect(result.diagnostics).toMatchObject([{ ruleId: "LIMIT_EVENT" }]);
});
it("unmatched closing brackets cannot hide later excessive nesting", () => {
  const text = "]".repeat(10000) + "[".repeat(10000) + "0" + "]".repeat(10000);
  try {
    parseTrace(text);
    throw new Error("Expected rejection");
  } catch (e) {
    expect(e).toMatchObject({ code: "PARSE_DEPTH" });
  }
});
