import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  inspectProducerUpdates,
  requestText,
  formatProducerUpdates,
} from "./lib/producer-updates.mjs";
import { lintEvents, parseTrace } from "../dist/index.js";
const output = process.argv[2];
if (!output || process.argv.length > 4)
  throw new Error(
    "Usage: node scripts/check-producer-updates.mjs NEW_OUTPUT_DIR [FULL_REVISION]",
  );
await mkdir(output);
let report;
try {
  report = await inspectProducerUpdates({
    manifest: JSON.parse(
      await readFile("test/fixtures/producers/manifest.json", "utf8"),
    ),
    readFixture: (file) =>
      readFile(join("test/fixtures/producers", file), "utf8"),
    request: (url) => requestText(url, { token: process.env.GH_TOKEN }),
    validate: (text) => lintEvents(parseTrace(text)),
    revision: process.argv[3],
    reviews: JSON.parse(await readFile("scripts/producer-reviews.json", "utf8"))
      .reviews,
  });
} catch {
  report = {
    schemaVersion: 1,
    status: "unavailable",
    error:
      "Unable to verify the baseline or resolve the upstream revision. No compatibility conclusion is available.",
    files: [],
  };
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
report.tool = {
  packageVersion: pkg.version,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  workingTreeModified: Boolean(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
    }).trim(),
  ),
  coreVersion: pkg.dependencies["@ag-ui/core"],
};
await writeFile(
  join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
await writeFile(join(output, "summary.md"), formatProducerUpdates(report), {
  flag: "wx",
});
console.log(formatProducerUpdates(report));
process.exitCode =
  report.status === "unchanged" || report.status === "reviewed"
    ? 0
    : report.status === "review-required"
      ? 1
      : 2;
