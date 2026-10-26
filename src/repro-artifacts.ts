import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Reproducer } from "./reproduce";

/** New private directory only; no existing artifacts are replaced. */
export async function writeReproArtifacts(
  result: Reproducer,
  directory: string,
): Promise<void> {
  await mkdir(directory, { mode: 0o700 });
  const { ndjson, ...manifest } = result;
  await writeFile(path.join(directory, "repro.ndjson"), ndjson, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const issue = [
    `# Reproducer for ${result.finding.diagnostic.ruleId}`,
    "",
    `FlowLint ${result.flowlintVersion}; AG-UI 1.0.`,
    "",
    `Selected finding: ${result.finding.id}`,
    "",
    `Retained ${result.stats.retainedEvents} of ${result.stats.originalEvents} events; ${result.stats.checks} candidate checks. Stop reason: ${result.stopReason}.`,
    "",
    "## Reproduce",
    "",
    "```sh",
    `flowlint check repro.ndjson${result.options.allowPartial ? " --allow-partial" : ""}`,
    "```",
    "",
    (result.validation.valid
      ? "The check is expected to pass with warning findings."
      : "The check is expected to report lint errors.") +
      " See manifest.json for the verified result and original event mapping.",
    "",
    "## Selected finding",
    "",
    "```json",
    JSON.stringify(result.finding.diagnostic, null, 2),
    "```",
    "",
    "This is an event-deletion reduction, not a globally minimal example or a redacted trace. Retained events may contain private payloads. Review both files before attaching them to a public issue.",
    "",
  ].join("\n");
  await writeFile(path.join(directory, "issue.md"), issue, {
    flag: "wx",
    mode: 0o600,
  });
}
