#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { createReadStream } from "node:fs";
import {
  lintEvents,
  SUPPORTED_RULES,
  parseTrace,
  TraceInputError,
  MAX_INPUT_BYTES,
} from "./index";
import type { Diagnostic, InputFormat, LintResult } from "./types";
import packageJson from "../package.json";
async function readInput(file: string): Promise<string> {
  const stream = file === "-" ? process.stdin : createReadStream(file);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_INPUT_BYTES) {
      stream.destroy();
      throw new TraceInputError(
        "PARSE_LIMIT",
        "Trace exceeds the 10 MiB input limit",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function report(result: LintResult, format: string, file: string): void {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `${file}\nAG-UI 1.0; FlowLint supported rules: ${result.supportedRules.length} (${result.supportedRules.join(", ")})`,
  );
  for (const d of result.diagnostics)
    console.log(
      `  ${d.line ?? "?"}:${d.column ?? "?"}  ${d.severity}  ${d.ruleId}  ${d.message}`,
    );
  const errors = result.diagnostics.filter(
    (d) => d.severity === "error",
  ).length;
  console.log(
    `${errors} errors, ${result.diagnostics.length - errors} warnings (${result.checkedEvents} events checked)`,
  );
}
const program = new Command()
  .name("flowlint")
  .description("Offline checks for AG-UI event traces")
  .version(packageJson.version);
program.exitOverride();
program
  .command("check")
  .argument("<file>", "NDJSON/JSON trace, or - for stdin")
  .option("--input <format>", "auto, ndjson, or json", "auto")
  .option("--format <format>", "pretty or json", "pretty")
  .option(
    "--allow-partial",
    "Warn on uncertain capture boundaries and EOF truncation",
  )
  .action(
    async (
      file: string,
      options: { input: InputFormat; format: string; allowPartial?: boolean },
    ) => {
      try {
        if (!["pretty", "json"].includes(options.format))
          throw new TraceInputError(
            "CLI_USAGE",
            "Output format must be pretty or json",
          );
        const result = lintEvents(
          parseTrace(await readInput(file), { format: options.input }),
          { allowPartial: options.allowPartial },
        );
        report(result, options.format, file);
        process.exitCode = result.valid ? 0 : 1;
      } catch (error) {
        const d: Diagnostic =
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
        report(
          {
            valid: false,
            protocol: "ag-ui/1.0",
            checkedEvents: 0,
            supportedRules: [...SUPPORTED_RULES],
            diagnostics: [d],
          },
          options.format,
          file,
        );
        process.exitCode = 2;
      }
    },
  );
if (process.argv.length === 2) {
  program.outputHelp();
  process.exitCode = 2;
} else {
  program.exitOverride();
  try {
    await program.parseAsync();
  } catch (error) {
    if (error instanceof CommanderError)
      process.exitCode = error.exitCode === 0 ? 0 : 2;
    else throw error;
  }
}
