import { stat } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";
import { lintEvents, SUPPORTED_RULES } from "./lint";
import { parseTrace, TraceInputError } from "./parse";
import { readInput } from "./read-input";
import { formatPretty } from "./reporters";
import type { Diagnostic, InputFormat, LintResult } from "./types";

type ExitCode = 0 | 1 | 2;
type SuiteResult = {
  schemaVersion: 1;
  valid: boolean;
  exitCode: ExitCode;
  files: { path: string; exitCode: ExitCode; result: LintResult }[];
  problems: { input: string; diagnostic: Diagnostic }[];
  summary: { files: number; events: number; errors: number; warnings: number };
};
const empty = (): SuiteResult => ({
  schemaVersion: 1,
  valid: true,
  exitCode: 0,
  files: [],
  problems: [],
  summary: { files: 0, events: 0, errors: 0, warnings: 0 },
});
function summarize(suite: SuiteResult): SuiteResult {
  const diagnostics = [
    ...suite.problems.map((p) => p.diagnostic),
    ...suite.files.flatMap((f) => f.result.diagnostics),
  ];
  suite.exitCode =
    suite.problems.length || suite.files.some((f) => f.exitCode === 2)
      ? 2
      : suite.files.some((f) => f.exitCode === 1)
        ? 1
        : 0;
  suite.valid = suite.exitCode === 0;
  suite.summary = {
    files: suite.files.length,
    events: suite.files.reduce((n, f) => n + f.result.checkedEvents, 0),
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warning").length,
  };
  return suite;
}
export function suiteFailure(diagnostic: Diagnostic): SuiteResult {
  return summarize({ ...empty(), problems: [{ input: "", diagnostic }] });
}
const failure = (diagnostic: Diagnostic): LintResult => ({
  valid: false,
  protocol: "ag-ui/1.0",
  checkedEvents: 0,
  supportedRules: [...SUPPORTED_RULES],
  diagnostics: [diagnostic],
});

export async function runSuite(
  patterns: string[],
  options: { input: InputFormat; allowPartial?: boolean },
): Promise<SuiteResult> {
  const suite = empty();
  const files = new Set<string>();
  for (const input of [...new Set(patterns)].sort()) {
    const problem = (ruleId: string, message: string) =>
      suite.problems.push({
        input,
        diagnostic: { ruleId, severity: "error", message },
      });
    if (input === "-" || input.startsWith("!")) {
      problem("SUITE_INPUT", "Stdin and negated patterns are not supported");
      continue;
    }
    try {
      // Prefer literal paths, including names containing glob metacharacters.
      const info = await stat(input).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR")
          return undefined;
        throw error;
      });
      if (info && !info.isFile()) {
        problem("SUITE_INPUT", "Input must be a regular file or a file glob");
        continue;
      }
      const matches = info
        ? [input]
        : await glob(path.resolve(input).replaceAll("\\", "/"), {
            cwd: path.parse(path.resolve(input)).root,
            absolute: true,
            onlyFiles: true,
            expandDirectories: false,
            followSymbolicLinks: false,
          });
      if (!matches.length)
        problem("SUITE_NO_MATCH", "Input did not match any files");
      for (const file of matches) files.add(path.resolve(file));
    } catch {
      problem("SUITE_DISCOVERY", "Unable to discover input files");
    }
  }
  // Read sequentially so the existing per-file byte budget is not multiplied by concurrency.
  for (const file of [...files].sort()) {
    const name = path.relative(process.cwd(), file).split(path.sep).join("/");
    try {
      const result = lintEvents(
        parseTrace(await readInput(file), { format: options.input }),
        { allowPartial: options.allowPartial },
      );
      suite.files.push({ path: name, exitCode: result.valid ? 0 : 1, result });
    } catch (error) {
      const diagnostic: Diagnostic =
        error instanceof TraceInputError
          ? {
              ruleId: error.code,
              severity: "error",
              message: error.message,
              line: error.line,
              column: error.column,
            }
          : {
              ruleId: "INPUT_READ",
              severity: "error",
              message: "Unable to read trace input",
            };
      suite.files.push({
        path: name,
        exitCode: 2,
        result: failure(diagnostic),
      });
    }
  }
  return summarize(suite);
}
const escapeData = (value: string) =>
  value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const escapeProperty = (value: string) =>
  escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
function annotation(d: Diagnostic, file?: string): string {
  const properties = [`title=${escapeProperty(d.ruleId)}`];
  if (file) {
    properties.push(`file=${escapeProperty(file)}`);
    if (d.line) properties.push(`line=${d.line}`);
    if (d.column) properties.push(`col=${d.column}`);
  }
  return `::${d.severity} ${properties.join(",")}::${escapeData(d.message)}`;
}
const markdownText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;")
    .replaceAll("*", "&#42;")
    .replaceAll("_", "&#95;");
export function formatSuite(suite: SuiteResult, format: string): string {
  if (format === "json") return JSON.stringify(suite, null, 2);
  const s = suite.summary;
  const summary = `${s.files} files, ${s.events} events, ${s.errors} errors, ${s.warnings} warnings`;
  if (format === "github")
    return [
      ...suite.problems.map((p) =>
        annotation({
          ...p.diagnostic,
          message: `${p.input}: ${p.diagnostic.message}`,
        }),
      ),
      ...suite.files.flatMap((f) =>
        f.result.diagnostics.map((d) => annotation(d, f.path)),
      ),
      summary,
    ].join("\n");
  if (format === "markdown")
    return [
      "## FlowLint",
      "",
      summary,
      "",
      "| File | Result | Errors | Warnings |",
      "| --- | --- | ---: | ---: |",
      ...suite.files.map(
        (f) =>
          `| ${markdownText(f.path)} | ${f.exitCode === 2 ? "Input error" : f.exitCode === 1 ? "Failed" : "Passed"} | ${f.result.diagnostics.filter((d) => d.severity === "error").length} | ${f.result.diagnostics.filter((d) => d.severity === "warning").length} |`,
      ),
      ...suite.problems.map(
        (p) =>
          `\n- ${markdownText(p.input)}: ${markdownText(p.diagnostic.message)}`,
      ),
    ].join("\n");
  return [
    ...suite.problems.map(
      (p) =>
        `${JSON.stringify(p.input)}: ${p.diagnostic.ruleId} ${p.diagnostic.message}`,
    ),
    ...suite.files.map((f) => formatPretty(f.result, JSON.stringify(f.path))),
    summary,
  ].join("\n\n");
}
