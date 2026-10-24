import type { LintResult } from "./types";
/** Machine-readable output retains the library result shape and excludes terminal styling. */
export function formatJson(result: LintResult): string {
  return JSON.stringify(result, null, 2);
}
/** The caller decides whether its output destination supports color. */
export function formatPretty(
  result: LintResult,
  source: string,
  options: { color?: boolean } = {},
): string {
  const paint = (text: string, code: number) =>
    options.color ? `\u001b[${code}m${text}\u001b[0m` : text;
  const rows = result.diagnostics.map((d) => ({
    location: `${d.line ?? "?"}:${d.column ?? "?"}`,
    severity: d.severity,
    rule: d.ruleId,
    message: d.message,
    related: d.related,
  }));
  const width = (key: "location" | "severity" | "rule") =>
    rows.reduce((max, row) => Math.max(max, row[key].length), 0);
  const locationWidth = width("location");
  const severityWidth = width("severity");
  const ruleWidth = width("rule");
  const lines = [
    source,
    `AG-UI 1.0; FlowLint supported rules: ${result.supportedRules.length} (${result.supportedRules.join(", ")})`,
  ];
  if (rows.length) lines.push("");
  for (const row of rows) {
    lines.push(
      `  ${row.location.padEnd(locationWidth)}  ${paint(row.severity.padEnd(severityWidth), row.severity === "error" ? 31 : 33)}  ${row.rule.padEnd(ruleWidth)}  ${row.message}`,
    );
    for (const related of row.related ?? [])
      lines.push(
        `    ${related.line}:${related.column}  ${related.message} (event ${related.eventIndex})`,
      );
  }
  const errors = rows.filter((row) => row.severity === "error").length;
  const warnings = rows.length - errors;
  const summary = `${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"} (${result.checkedEvents} ${result.checkedEvents === 1 ? "event" : "events"} checked)`;
  lines.push("", paint(summary, errors ? 31 : warnings ? 33 : 32));
  return lines.join("\n");
}
