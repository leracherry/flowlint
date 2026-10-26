import type { TraceComparison } from "./compare";

/** Human-readable overview; full protocol diagnostics and alias maps stay in JSON. */
export function formatComparison(result: TraceComparison): string {
  const errors = (side: "before" | "after") =>
    result.protocol[side].diagnostics.filter((d) => d.severity === "error")
      .length;
  const warnings = (side: "before" | "after") =>
    result.protocol[side].diagnostics.filter((d) => d.severity === "warning")
      .length;
  const lines = [
    `FlowLint comparison: ${result.status}`,
    `Policy: ${result.policy}`,
    `Protocol before: ${errors("before")} errors, ${warnings("before")} warnings; after: ${errors("after")} errors, ${warnings("after")} warnings`,
    `Canonical events: ${result.summary.beforeCanonicalEvents} before, ${result.summary.afterCanonicalEvents} after`,
  ];
  for (const issue of result.issues)
    lines.push(
      `${issue.side}: ${issue.code}: ${issue.message}${issue.source ? ` (event ${issue.source.eventIndex}, ${issue.source.line}:${issue.source.column})` : ""}`,
    );
  for (const difference of result.differences) {
    if (difference.kind === "state")
      lines.push(`State outcome changed for ${difference.thread}`);
    else {
      const location = (value: typeof difference.before) =>
        value
          ? `event ${value.eventIndex} ${value.type} at ${value.line}:${value.column}`
          : "no event";
      lines.push(
        `${location(difference.before)} -> ${location(difference.after)}; fields: ${difference.fields.map((field) => JSON.stringify(field)).join(", ")}${difference.fieldsOmitted ? ` (+${difference.fieldsOmitted} omitted)` : ""}`,
      );
    }
  }
  lines.push(
    `${result.differenceCount} differences; ${result.differencesOmitted} details omitted`,
    "Values are omitted. Event differences align canonical arrival positions; inspect JSON and source events for context.",
  );
  return lines.join("\n");
}
