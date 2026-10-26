import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { generateHtmlReport, parseTrace } from "../src/index";
const events = [
  { type: "RUN_STARTED", threadId: "t", runId: "r" },
  { type: "TEXT_MESSAGE_START", messageId: "m", name: "PRIVATE_NAME" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "PRIVATE_BODY" },
  { type: "TEXT_MESSAGE_END", messageId: "m" },
  { type: "TEXT_MESSAGE_START", messageId: "m" },
  { type: "TEXT_MESSAGE_END", messageId: "m" },
  { type: "RUN_FINISHED", threadId: "t", runId: "r" },
];
const records = (input = events) => parseTrace(JSON.stringify(input));
it("links findings and earlier evidence to the original event rows", () => {
  const html = generateHtmlReport(records(), { source: "trace.ndjson" });
  expect(html).toContain('href="#event-4"');
  expect(html).toContain('href="#event-1"');
  expect(html).toContain('id="event-4"');
  expect(html).toContain("Attributes established here");
  expect(html).toContain("Event 4 · 1:");
  expect(html).toContain("ITEM_REOPEN");
});
it("omits payload fields and values from the complete HTML artifact", () => {
  const html = generateHtmlReport(
    parseTrace(
      JSON.stringify([
        ...events.slice(0, -1),
        { type: "RAW", event: { password: "PRIVATE_RAW" } },
        { type: "STATE_SNAPSHOT", snapshot: { token: "PRIVATE_STATE" } },
        {
          type: "TOOL_CALL_START",
          toolCallId: "c",
          toolCallName: "PRIVATE_TOOL",
        },
        { type: "TOOL_CALL_ARGS", toolCallId: "c", delta: "PRIVATE_ARGUMENTS" },
        { type: "TOOL_CALL_END", toolCallId: "c" },
        events.at(-1),
      ]),
    ),
  );
  expect(html).not.toContain("PRIVATE_");
  expect(html).toContain("STATE_SNAPSHOT");
  expect(html).toContain("Payloads omitted");
});
it("escapes trace-controlled source labels and identifiers", () => {
  const attack =
    '</title><img src="https://example.com" onerror="alert(1)"><script>globalThis.pwned=1</script>';
  const html = generateHtmlReport(
    parseTrace(
      JSON.stringify([{ type: "TEXT_MESSAGE_END", messageId: attack }]),
    ),
    { source: attack },
  );
  expect(html).not.toContain(attack);
  expect(html).not.toContain('<img src="https://example.com"');
  expect(html).toContain("&lt;/title&gt;");
  expect(html.match(/<script>/g) ?? []).toHaveLength(1);
});
it("hashes the exact embedded scripts and styles for its restrictive policy", () => {
  const html = generateHtmlReport(records());
  for (const tag of ["script", "style"]) {
    const content = html.match(
      new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`),
    )![1]!;
    const hash = createHash("sha256").update(content).digest("base64");
    expect(html).toContain(`${tag}-src &#39;sha256-${hash}&#39;`);
  }
  expect(html).toContain("default-src &#39;none&#39;");
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/);
});
it("prioritizes related evidence over earlier unrelated rows at the render limit", () => {
  const html = generateHtmlReport(records(), { maxEvents: 2 });
  expect(html).toContain('id="event-4"');
  expect(html).toContain('id="event-1"');
  expect(html).not.toContain('id="event-0"');
  expect(html).toContain("2 of 7 events rendered; 5 omitted");
  expect(html.match(/class="event"/g) ?? []).toHaveLength(2);
});
it("labels findings without rendered evidence and handles empty results", () => {
  const html = generateHtmlReport(records(), { maxEvents: 1 });
  expect(html).toContain("event not rendered");
  expect(generateHtmlReport([])).toContain("No lint errors found");
  expect(generateHtmlReport([])).toContain("0 of 0 events rendered");
  for (const maxEvents of [0, -1, NaN, 10001, 1.5])
    expect(() => generateHtmlReport([], { maxEvents })).toThrow(RangeError);
});
it("keeps report generation deterministic and records partial capture uncertainty", () => {
  const input = records();
  expect(generateHtmlReport(input)).toBe(generateHtmlReport(input));
  expect(generateHtmlReport(input, { allowPartial: true })).toContain(
    "Partial capture mode",
  );
  expect(generateHtmlReport(input)).toContain(
    "Inherited ownership is not inferred",
  );
});
it("bounds rendered metadata for a large trace without omitting lint checks", () => {
  const input = parseTrace(
    JSON.stringify([
      { type: "RUN_STARTED", threadId: "t", runId: "r" },
      ...Array.from({ length: 20000 }, (_, i) => ({
        type: "RAW",
        event: { i, secret: "PRIVATE_BODY" },
      })),
      { type: "RUN_FINISHED", threadId: "t", runId: "r" },
    ]),
  );
  const html = generateHtmlReport(input);
  expect(html).toContain("20002</strong>");
  expect(html).toContain("2000 of 20002 events rendered; 18002 omitted");
  expect(Buffer.byteLength(html)).toBeLessThan(1500000);
  expect(html).not.toContain("PRIVATE_BODY");
});

it("does not merge agent groups whose shortened labels collide", () => {
  const prefix = "a".repeat(200);
  const html = generateHtmlReport(
    parseTrace(
      JSON.stringify([
        { type: "RUN_STARTED", threadId: "t", runId: "r" },
        { type: "RAW", event: {}, subagentRunId: prefix + "one" },
        { type: "RAW", event: {}, subagentRunId: prefix + "two" },
        { type: "RUN_FINISHED", threadId: "t", runId: "r" },
      ]),
    ),
  );
  expect(html.match(/class="group"/g) ?? []).toHaveLength(3);
});
