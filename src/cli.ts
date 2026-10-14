#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { createReadStream } from "node:fs";
import {
  lintEvents,
  SUPPORTED_RULES,
  parseTrace,
  TraceInputError,
  MAX_INPUT_BYTES,
} from "./index";
import type { Diagnostic, InputFormat, LintResult } from "./types";
import { formatJson, formatPretty } from "./reporters";
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
  console.log(
    format === "json"
      ? formatJson(result)
      : formatPretty(result, file, {
          color: !!process.stdout.isTTY && process.env.NO_COLOR === undefined,
        }),
  );
}
function reportFailure(diagnostic: Diagnostic, format: string, source: string) {
  report(
    {
      valid: false,
      protocol: "ag-ui/1.0",
      checkedEvents: 0,
      supportedRules: [...SUPPORTED_RULES],
      diagnostics: [diagnostic],
    },
    format,
    source,
  );
  process.exitCode = 2;
}
const program = new Command()
  .name("flowlint")
  .description("Offline checks for AG-UI event traces")
  .version(packageJson.version)
  .configureOutput({ writeErr: () => {} });
program.exitOverride();
const checkCommand = program
  .command("check")
  .allowExcessArguments(false)
  .argument(
    "<file>",
    "one NDJSON/JSON file, or - for stdin (no glob expansion)",
  )
  .addOption(
    new Option("--input <format>", "input encoding")
      .choices(["auto", "ndjson", "json", "sse"])
      .default("auto"),
  )
  .addOption(
    new Option("--format <format>", "output format")
      .choices(["pretty", "json"])
      .default("pretty"),
  )
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
        reportFailure(d, options.format, file);
      }
    },
  );
if (process.argv.length === 2) {
  program.outputHelp();
  process.exitCode = 2;
} else {
  program.exitOverride();
  try {
    await program.parseAsync(process.argv, { from: "node" });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) process.exitCode = 0;
      else {
        // Even failures before argument parsing finish honor a requested JSON format.
        const args = process.argv.slice(2);
        const jsonRequested = args.some(
          (arg, i) =>
            arg === "--format=json" ||
            (arg === "--format" && args[i + 1] === "json"),
        );
        reportFailure(
          {
            ruleId: "CLI_USAGE",
            severity: "error",
            message: error.message.replace(/^error: /, ""),
          },
          jsonRequested ? "json" : "pretty",
          checkCommand.args[0] ?? "flowlint",
        );
      }
    } else throw error;
  }
}
