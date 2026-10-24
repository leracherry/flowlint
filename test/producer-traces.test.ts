import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintEvents, parseTrace } from "../src/index";
import manifest from "./fixtures/producers/manifest.json";
const root = new URL("./fixtures/producers/", import.meta.url);
const load = (file: string) => readFileSync(new URL(file, root), "utf8");
const expected = (journey: string) => {
  const indices =
    journey === "approvesSubagentAnswer"
      ? [38, 55]
      : journey === "rejectsSubagentAnswer"
        ? [38, 52]
        : [];
  return indices.map((eventIndex) => ({
    ruleId: "ITEM_REOPEN",
    severity: "error",
    eventIndex,
    message: "Reopened tool call conflicts with established parentMessageId",
  }));
};
describe("recorded producer journeys", () => {
  for (const trace of manifest.traces) {
    it(`${trace.producer}: ${trace.journey}`, () => {
      const source = load(trace.file);
      expect(createHash("sha256").update(source).digest("hex")).toBe(
        trace.sha256,
      );
      const records = parseTrace(source);
      expect(records).toHaveLength(trace.events);
      const result = lintEvents(records);
      expect(result.diagnostics).toEqual(
        expected(trace.journey).map((d) => ({
          ...d,
          line: d.eventIndex + 1,
          column: 1,
          context: {
            entityKind: "toolCall",
            entityId: d.eventIndex === 38 ? "id-7" : "id-4",
            fields: ["parentMessageId"],
          },
          related: [
            {
              eventIndex: 35,
              line: 36,
              column: 1,
              message: "Attributes established here",
            },
          ],
        })),
      );
      expect(result.valid).toBe(expected(trace.journey).length === 0);
    });
    it(`${trace.journey} agrees across JSON and derived SSE framing`, () => {
      const events = parseTrace(load(trace.file)).map((r) => r.event);
      const diagnostics = (source: string) =>
        lintEvents(parseTrace(source)).diagnostics.map((d) => ({
          ruleId: d.ruleId,
          severity: d.severity,
          eventIndex: d.eventIndex,
          message: d.message,
        }));
      expect(diagnostics(JSON.stringify(events))).toEqual(
        expected(trace.journey),
      );
      expect(
        diagnostics(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
        ),
      ).toEqual(expected(trace.journey));
    });
  }
});
const simple = manifest.traces.find(
  (t) =>
    t.producer === "awsStrandsTests" &&
    t.journey === "agenticChatSendsAndReceivesAMessage",
)!;
const simpleEvents = () =>
  parseTrace(load(simple.file)).map((r) => r.event as Record<string, unknown>);
it("detects a missing message end in a damaged real trace", () => {
  const events = simpleEvents().filter((e) => e.type !== "TEXT_MESSAGE_END");
  expect(
    lintEvents(parseTrace(JSON.stringify(events))).diagnostics.map(
      (d) => d.ruleId,
    ),
  ).toContain("FL003");
});
it("reports truncation while allowing the same real excerpt in partial mode", () => {
  const source = JSON.stringify(simpleEvents().slice(0, -1));
  expect(lintEvents(parseTrace(source)).diagnostics).toMatchObject([
    { ruleId: "FL012", severity: "error" },
  ]);
  expect(
    lintEvents(parseTrace(source), { allowPartial: true }).diagnostics,
  ).toMatchObject([{ ruleId: "FL012", severity: "warning" }]);
});
it.each(["approvesSubagentAnswer", "rejectsSubagentAnswer"])(
  "isolates the missing parent in %s without changing the fixture",
  (journey) => {
    const trace = manifest.traces.find((t) => t.journey === journey)!;
    const events = parseTrace(load(trace.file)).map(
      (r) => r.event as Record<string, unknown>,
    );
    const parents = new Map<string, unknown>();
    for (const event of events)
      if (event.type === "TOOL_CALL_START") {
        const id = event.toolCallId as string;
        if (event.parentMessageId !== undefined)
          parents.set(id, event.parentMessageId);
        else if (parents.has(id)) event.parentMessageId = parents.get(id);
      }
    expect(lintEvents(parseTrace(JSON.stringify(events))).diagnostics).toEqual(
      [],
    );
  },
);
