import { expect, it } from "vitest";
import { formatJson, formatPretty } from "../src/index";
import type { LintResult } from "../src/index";
const result: LintResult = {
  valid: false,
  protocol: "ag-ui/1.0",
  checkedEvents: 12,
  supportedRules: ["FL002", "FL012"],
  diagnostics: [
    {
      ruleId: "FL002",
      severity: "error",
      message: 'Unopened message "m"',
      eventIndex: 2,
      line: 3,
      column: 1,
    },
    {
      ruleId: "FL012",
      severity: "warning",
      message: "Capture ended",
      eventIndex: 11,
      line: 12,
      column: 10,
    },
  ],
};
it("aligns pretty columns and counts severities", () => {
  expect(formatPretty(result, "trace.ndjson")).toBe(
    'trace.ndjson\nAG-UI 1.0; FlowLint supported rules: 2 (FL002, FL012)\n\n  3:1    error    FL002  Unopened message "m"\n  12:10  warning  FL012  Capture ended\n\n1 error, 1 warning (12 events checked)',
  );
});
it("styles severity and summary only when color is requested", () => {
  expect(formatPretty(result, "trace", { color: true })).toContain(
    "\u001b[31m",
  );
  expect(formatPretty(result, "trace")).not.toContain("\u001b");
});
it("preserves JSON result shape without mutation or styling", () => {
  expect(JSON.parse(formatJson(result))).toEqual(result);
  expect(formatJson(result)).not.toContain("\u001b");
  expect(formatPretty(result, "trace")).toBe(formatPretty(result, "trace"));
});
it("formats a clean single-event result and unknown locations", () => {
  expect(
    formatPretty(
      { ...result, valid: true, checkedEvents: 1, diagnostics: [] },
      "-",
    ),
  ).toContain("0 errors, 0 warnings (1 event checked)");
  expect(
    formatPretty(
      {
        ...result,
        diagnostics: [
          {
            ruleId: "INPUT_READ",
            severity: "error",
            message: "Unable to read trace",
          },
        ],
      },
      "missing",
    ),
  ).toContain("?:?");
});

it("renders related evidence beneath its finding and preserves it in JSON", () => {
  const enriched: LintResult = {
    ...result,
    diagnostics: [
      {
        ...result.diagnostics[0]!,
        related: [
          {
            eventIndex: 0,
            line: 1,
            column: 3,
            message: "Attributes established here",
          },
        ],
      },
    ],
  };
  expect(formatPretty(enriched, "trace")).toContain(
    "    1:3  Attributes established here (event 0)",
  );
  expect(JSON.parse(formatJson(enriched))).toEqual(enriched);
});
