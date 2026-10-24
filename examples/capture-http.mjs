import { HttpAgent } from "@ag-ui/client";
import { createHttpCapture } from "@leracherry/flowlint";

const [url, directory, name, version] = process.argv.slice(2);
if (!url || !directory || !name || !version) {
  console.error(
    "Usage: node examples/capture-http.mjs <url> <directory> <producer-name> <producer-version>",
  );
  process.exitCode = 2;
} else {
  const capture = createHttpCapture({ directory, producer: { name, version } });
  const agent = new HttpAgent({ url, fetch: capture.fetch });
  try {
    await agent.runAgent();
  } finally {
    const manifests = await capture.flush();
    for (const manifest of manifests) {
      console.log(
        `${manifest.file}: ${manifest.outcome}${manifest.truncated ? " (truncated)" : ""}${manifest.writeError ? " (write failed)" : ""}`,
      );
      if (
        manifest.writeError ||
        manifest.truncated ||
        manifest.outcome !== "complete"
      )
        process.exitCode = 1;
    }
  }
}
