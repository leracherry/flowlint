#!/usr/bin/env node
import {
  Command,
  CommanderError,
  Option,
  InvalidArgumentError,
} from "commander";
import { compareTraces } from "./compare";
import { formatComparison } from "./compare-report";
import { getReproFindings, minimizeTrace } from "./reproduce";
import { writeReproArtifacts } from "./repro-artifacts";
import { writeFile } from "node:fs/promises";
import { formatHtmlReport } from "./html-report";
import { readInput } from "./read-input";
import { runSuite, formatSuite, suiteFailure } from "./suite";
import {
  lintEvents,
  SUPPORTED_RULES,
  parseTrace,
  TraceInputError,
} from "./index";
import type { Diagnostic, InputFormat, LintResult } from "./types";
import { formatJson, formatPretty } from "./reporters";
import packageJson from "../package.json";
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
program
  .command("suite")
  .argument("<patterns...>", "files or quoted globs (no stdin)")
  .addOption(
    new Option("--input <format>", "input encoding")
      .choices(["auto", "ndjson", "json", "sse"])
      .default("auto"),
  )
  .addOption(
    new Option("--format <format>", "output format")
      .choices(["pretty", "json", "github", "markdown"])
      .default("pretty"),
  )
  .option("--allow-partial", "Allow incomplete capture boundaries")
  .action(
    async (
      patterns: string[],
      options: { input: InputFormat; format: string; allowPartial?: boolean },
    ) => {
      const result = await runSuite(patterns, options);
      console.log(formatSuite(result, options.format));
      process.exitCode = result.exitCode;
    },
  );
program
  .command("report")
  .allowExcessArguments(false)
  .argument("<file>", "trace file, or - for stdin")
  .requiredOption(
    "--output <file>",
    "new HTML file (existing files are not overwritten)",
  )
  .addOption(
    new Option("--input <format>", "input encoding")
      .choices(["auto", "ndjson", "json", "sse"])
      .default("auto"),
  )
  .option("--allow-partial", "Allow incomplete capture boundaries")
  .option(
    "--max-events <count>",
    "timeline rows to render (1–10000)",
    (value: string) => {
      const count = Number(value);
      if (!Number.isSafeInteger(count) || count < 1 || count > 10000)
        throw new InvalidArgumentError(
          "Expected an integer between 1 and 10000",
        );
      return count;
    },
    2000,
  )
  .action(
    async (
      file: string,
      options: {
        output: string;
        input: InputFormat;
        allowPartial?: boolean;
        maxEvents: number;
      },
    ) => {
      let records;
      try {
        records = parseTrace(await readInput(file), { format: options.input });
      } catch (error) {
        reportFailure(
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
              },
          "pretty",
          file,
        );
        return;
      }
      try {
        const result = lintEvents(records, options);
        const html = formatHtmlReport(records, result, {
          source: file,
          allowPartial: options.allowPartial,
          maxEvents: options.maxEvents,
        });
        await writeFile(options.output, html, { flag: "wx", mode: 0o600 });
        console.log(`Report written to ${JSON.stringify(options.output)}`);
        process.exitCode = result.valid ? 0 : 1;
      } catch {
        reportFailure(
          {
            ruleId: "REPORT_WRITE",
            severity: "error",
            message:
              "Unable to create report; output must be a new writable file",
          },
          "pretty",
          file,
        );
      }
    },
  );
program
  .command("minimize")
  .allowExcessArguments(false)
  .argument("<file>", "trace file, or - for stdin")
  .option("--list", "list finding IDs and reduction eligibility")
  .option("--finding <id>", "finding ID from --list")
  .option("--output <directory>", "new output directory (parent must exist)")
  .option(
    "--allow-partial",
    "Use the same partial capture mode when listing and reducing",
  )
  .option("--progress", "write candidate progress to stderr")
  .option("--max-checks <count>", "candidate check budget (1–10000)", "200")
  .option(
    "--max-duration-ms <count>",
    "cooperative time budget (1–60000 ms)",
    "5000",
  )
  .action(
    async (
      file: string,
      options: {
        list?: boolean;
        finding?: string;
        output?: string;
        allowPartial?: boolean;
        progress?: boolean;
        maxChecks: string;
        maxDurationMs: string;
      },
    ) => {
      if (
        (options.list && (options.finding || options.output)) ||
        (!options.list && (!options.finding || !options.output))
      ) {
        reportFailure(
          {
            ruleId: "CLI_USAGE",
            severity: "error",
            message:
              "Use --list alone, or provide both --finding and a new --output directory",
          },
          "pretty",
          file,
        );
        return;
      }
      const controller = new AbortController();
      const interrupt = () => controller.abort();
      try {
        const records = parseTrace(await readInput(file));
        if (options.list) {
          const findings = getReproFindings(records, options);
          console.log(
            findings.length
              ? findings
                  .map(
                    (f) =>
                      `${f.id}  ${f.diagnostic.ruleId} at event ${f.diagnostic.eventIndex ?? "?"}  ${f.supported ? "eligible" : f.reason}`,
                  )
                  .join("\n")
              : "No findings",
          );
          return;
        }
        process.once("SIGINT", interrupt);
        const result = await minimizeTrace(records, {
          findingId: options.finding!,
          allowPartial: options.allowPartial,
          maxChecks: Number(options.maxChecks),
          maxDurationMs: Number(options.maxDurationMs),
          signal: controller.signal,
          onProgress: options.progress
            ? (p) =>
                console.error(
                  `${p.checks} checks; ${p.retainedEvents} events retained; ${p.elapsedMs} ms`,
                )
            : undefined,
        });
        process.removeListener("SIGINT", interrupt);
        await writeReproArtifacts(result, options.output!);
        if (!result.finding.supported) console.error(result.finding.reason);
        console.log(
          `${result.stats.retainedEvents}/${result.stats.originalEvents} events retained; ${result.stats.checks} checks; ${result.stats.elapsedMs} ms; ${result.stopReason}. Bundle written to ${JSON.stringify(options.output)}`,
        );
        process.exitCode =
          result.stopReason === "cancelled"
            ? 130
            : result.stopReason === "unsupported"
              ? 2
              : 0;
      } catch (error) {
        reportFailure(
          {
            ruleId:
              error instanceof TraceInputError
                ? error.code
                : error instanceof RangeError
                  ? "REPRO_BUDGET"
                  : "REPRO_FAILURE",
            severity: "error",
            message:
              error instanceof TraceInputError || error instanceof RangeError
                ? error.message
                : "Unable to create reproducer; output must be a new directory with an existing writable parent",
          },
          "pretty",
          file,
        );
      } finally {
        process.removeListener("SIGINT", interrupt);
      }
    },
  );
program
  .command("compare")
  .allowExcessArguments(false)
  .argument("<before>", "original trace file, or - for stdin")
  .argument("<after>", "updated trace file, or - for stdin")
  .addOption(
    new Option("--policy <name>", "comparison policy")
      .choices(["adapter-upgrade/v1"])
      .default("adapter-upgrade/v1"),
  )
  .addOption(
    new Option("--format <format>", "output format")
      .choices(["pretty", "json"])
      .default("pretty"),
  )
  .option("--allow-partial", "Retain partial-capture uncertainty")
  .option(
    "--max-differences <count>",
    "difference details to retain (1–1000)",
    (value: string) => {
      const count = Number(value);
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000)
        throw new InvalidArgumentError(
          "Expected an integer between 1 and 1000",
        );
      return count;
    },
    50,
  )
  .action(
    async (
      before: string,
      after: string,
      options: {
        policy: "adapter-upgrade/v1";
        format: string;
        allowPartial?: boolean;
        maxDifferences: number;
      },
    ) => {
      if (before === "-" && after === "-") {
        reportFailure(
          {
            ruleId: "CLI_USAGE",
            severity: "error",
            message: "At most one comparison input may use stdin",
          },
          options.format,
          "compare",
        );
        return;
      }
      try {
        const a = parseTrace(await readInput(before));
        const b = parseTrace(await readInput(after));
        const result = compareTraces(a, b, options);
        console.log(
          options.format === "json"
            ? JSON.stringify(result, null, 2)
            : formatComparison(result),
        );
        process.exitCode =
          result.status === "equal" ? 0 : result.status === "changed" ? 1 : 3;
      } catch (error) {
        reportFailure(
          error instanceof TraceInputError
            ? {
                ruleId: error.code,
                severity: "error",
                message: error.message,
                line: error.line,
                column: error.column,
              }
            : {
                ruleId: "COMPARE_INPUT",
                severity: "error",
                message: "Unable to compare trace inputs",
              },
          options.format,
          "compare",
        );
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
        const diagnostic: Diagnostic = {
          ruleId: "CLI_USAGE",
          severity: "error",
          message: error.message.replace(/^error: /, ""),
        };
        if (args[0] === "suite") {
          console.log(
            formatSuite(
              suiteFailure(diagnostic),
              jsonRequested ? "json" : "pretty",
            ),
          );
          process.exitCode = 2;
        } else
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
