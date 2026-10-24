export type InputFormat = "auto" | "ndjson" | "json" | "sse";
export type DiagnosticLocation = {
  eventIndex: number;
  line: number;
  column: number;
};
export type Diagnostic = {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  eventIndex?: number;
  line?: number;
  column?: number;
  related?: (DiagnosticLocation & { message: string })[];
  context?: {
    entityKind: "message" | "toolCall";
    entityId: string;
    fields: string[];
  };
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
