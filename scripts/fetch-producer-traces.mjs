import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const destination = process.argv[2];
if (!destination)
  throw new Error("Usage: node scripts/fetch-producer-traces.mjs OUTPUT_DIR");
const manifest = JSON.parse(
  readFileSync("test/fixtures/producers/manifest.json", "utf8"),
);
mkdirSync(destination, { recursive: true });
for (const trace of new Map(
  manifest.traces.map((t) => [t.source, t]),
).values()) {
  const url = new URL(trace.source);
  const prefix = `/ag-ui-protocol/ag-ui/blob/${manifest.revision}/apps/dojo/e2e/tests/`;
  if (url.origin !== "https://github.com" || !url.pathname.startsWith(prefix))
    throw new Error("Unexpected source URL");
  const relative = url.pathname.slice(prefix.length);
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.event-trace\.ts$/.test(relative))
    throw new Error("Unexpected source path");
  const response = await fetch(
    `https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/${manifest.revision}/apps/dojo/e2e/tests/${relative}`,
  );
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const source = await response.text();
  if (createHash("sha256").update(source).digest("hex") !== trace.sourceSha256)
    throw new Error("Source checksum mismatch");
  writeFileSync(join(destination, relative.replace("/", "-")), source);
}
// The original upstream license is already checked in with the corpus.
writeFileSync(
  join(destination, "LICENSE"),
  readFileSync("test/fixtures/producers/LICENSE.upstream"),
);
console.log("Pinned upstream sources downloaded and verified");
