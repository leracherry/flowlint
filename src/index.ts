export { lintEvents, createLintSession, SUPPORTED_RULES } from "./lint";
export { parseTrace, TraceInputError, MAX_INPUT_BYTES } from "./parse";
export type {
  Diagnostic,
  DiagnosticLocation,
  InputFormat,
  LintOptions,
  LintSession,
  LintSessionOptions,
  LintResult,
  SourceEvent,
} from "./types";

export { formatPretty, formatJson } from "./reporters";

export { RULES } from "./rules";

export { createHttpCapture } from "./capture";
export type { CaptureManifest, HttpCaptureOptions } from "./capture";

export { parseTraceStream, lintTraceStream } from "./parse-stream";

export { generateHtmlReport } from "./html-report";
export type { HtmlReportOptions } from "./html-report";

export { getReproFindings, minimizeTrace } from "./reproduce";
export type {
  ReproFinding,
  ReproProgress,
  ReproOptions,
  Reproducer,
} from "./reproduce";

export { compareTraces } from "./compare";
export type {
  CompareOptions,
  ComparisonIssue,
  EntityMapping,
  StateOutcome,
  TraceDifference,
  TraceComparison,
} from "./compare";
export { formatComparison } from "./compare-report";
