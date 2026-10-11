export type InputFormat = "auto" | "ndjson" | "json";
export type Diagnostic = {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  eventIndex?: number;
  line?: number;
  column?: number;
};
export type SourceEvent = {
  event: unknown;
  eventIndex: number;
  line: number;
  column: number;
};
export type LintOptions = { protocol?: "ag-ui/1.0"; allowPartial?: boolean };
export type LintResult = {
  valid: boolean;
  protocol: "ag-ui/1.0";
  checkedEvents: number;
  supportedRules: string[];
  diagnostics: Diagnostic[];
};
