import { parseProducerSource } from "./lib/producer-data.mjs";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
// Parse a deliberately small data-only subset. Never execute upstream TypeScript.
const sourceDir = process.argv[2];
const outputDir = process.argv[3];
if (!sourceDir || !outputDir)
  throw new Error(
    "Usage: node scripts/import-producer-traces.mjs SOURCE_DIR OUTPUT_DIR [FULL_REVISION]",
  );
const revision = process.argv[4] ?? "89cedd3fd549feeee41e50e1d7c6d373e549241a";
if (!/^[a-f0-9]{40}$/.test(revision))
  throw new Error("Expected a full source revision");
mkdirSync(outputDir, { recursive: true });
const manifest = [];
for (const file of readdirSync(sourceDir)
  .filter((f) => f.endsWith(".event-trace.ts"))
  .sort()) {
  const source = readFileSync(join(sourceDir, file), "utf8");
  for (const [journey, events] of Object.entries(
    parseProducerSource(source, file),
  )) {
    const fixture = `${file.replace(".event-trace.ts", "")}-${journey}.ndjson`;
    const content =
      events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    writeFileSync(join(outputDir, fixture), content);
    const split = file.indexOf("-");
    const path = `apps/dojo/e2e/tests/${file.slice(0, split)}/${file.slice(split + 1)}`;
    manifest.push({
      file: fixture,
      producer: file.slice(0, split),
      journey,
      source: `https://github.com/ag-ui-protocol/ag-ui/blob/${revision}/${path}`,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      sha256: createHash("sha256").update(content).digest("hex"),
      events: events.length,
    });
  }
}
copyFileSync(join(sourceDir, "LICENSE"), join(outputDir, "LICENSE.upstream"));
writeFileSync(
  join(outputDir, "manifest.json"),
  JSON.stringify({ revision, traces: manifest }, null, 2) + "\n",
);
console.log(`Imported ${manifest.length} recorded journeys`);
