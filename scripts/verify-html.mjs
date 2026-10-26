import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { generateHtmlReport, parseTrace } from "../dist/index.js";
const directory = await mkdtemp(path.join(tmpdir(), "flowlint report "));
const source = await readFile(
  "test/fixtures/producers/langgraphFastAPITests-deepagentsSubagentsPage-approvesSubagentAnswer.ndjson",
  "utf8",
);
const filename = path.join(directory, "report.html");
await writeFile(
  filename,
  generateHtmlReport(parseTrace(source), {
    source: "DeepAgents / approval journey",
  }),
);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    offline: true,
  });
  const page = await context.newPage();
  const errors = [],
    network = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(pathToFileURL(filename).href);
  assert.equal(await page.locator("h1").textContent(), "Trace findings");
  assert.equal(await page.locator(".finding").count(), 2);
  assert.equal(await page.locator(".event").count(), 72);
  await page.locator("#search").fill("no event matches this");
  assert.equal(await page.locator(".event:visible").count(), 0);
  assert.equal(await page.locator("#no-matches").isVisible(), true);
  await page.locator('a[href="#event-35"]').first().click();
  await page.waitForFunction(() => document.activeElement?.id === "event-35");
  assert.equal(await page.locator("#search").inputValue(), "");
  assert.equal(await page.locator("#event-35").isVisible(), true);
  await page.locator("#search").fill("TOOL_CALL_START");
  assert.equal(await page.locator(".event:visible").count(), 4);
  await page.locator("#search").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "clear");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".event:visible").count(), 72);
  await page.goto(pathToFileURL(filename).href);
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".skip")
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "timeline",
  );
  await page.evaluate(() => scrollTo(0, 0));
  if (process.env.FLOWLINT_REPORT_SCREENSHOT)
    await page.screenshot({
      path: process.env.FLOWLINT_REPORT_SCREENSHOT,
      fullPage: false,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  if (process.env.FLOWLINT_REPORT_SCREENSHOT) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: process.env.FLOWLINT_REPORT_SCREENSHOT.replace(
        /\.png$/,
        "-mobile.png",
      ),
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);

  const hostile =
    '</title><img src="https://example.com/track" onerror="globalThis.pwned=1"><script>globalThis.pwned=1</script>';
  const attackFile = path.join(directory, "hostile.html");
  await writeFile(
    attackFile,
    generateHtmlReport(
      parseTrace(
        JSON.stringify([{ type: "TEXT_MESSAGE_END", messageId: hostile }]),
      ),
      { source: hostile },
    ),
  );
  await page.goto(pathToFileURL(attackFile).href);
  assert.equal(await page.locator("img").count(), 0);
  assert.equal(await page.locator("script").count(), 1);
  assert.equal(await page.evaluate(() => globalThis.pwned), undefined);
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);

  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    offline: true,
  });
  const staticPage = await noScript.newPage();
  await staticPage.goto(pathToFileURL(filename).href);
  await staticPage.locator('a[href="#event-35"]').first().click();
  assert.equal(await staticPage.locator("#event-35:target").count(), 1);
  const largeFile = path.join(directory, "large.html");
  const largeRecords = parseTrace(
    JSON.stringify([
      { type: "RUN_STARTED", threadId: "t", runId: "r" },
      ...Array.from({ length: 20000 }, (_, i) => ({
        type: "RAW",
        event: { i },
      })),
      { type: "RUN_FINISHED", threadId: "t", runId: "r" },
    ]),
  );
  const largeHtml = generateHtmlReport(largeRecords);
  await writeFile(largeFile, largeHtml);
  const before = performance.now();
  await page.goto(pathToFileURL(largeFile).href);
  assert.equal(await page.locator(".event").count(), 2000);
  assert.equal(
    await page.locator("#visible-count").textContent(),
    "2000 of 2000 rendered events shown",
  );
  console.log(
    JSON.stringify({
      checkedEvents: largeRecords.length,
      renderedEvents: 2000,
      htmlBytes: Buffer.byteLength(largeHtml),
      loadMs: Math.round(performance.now() - before),
    }),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  console.log(
    "Verified offline HTML: evidence links, filtering, keyboard focus, mobile layout, hostile labels, CSP, and no-script navigation.",
  );
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
