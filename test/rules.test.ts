import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { RULES, SUPPORTED_RULES } from "../src/index";

it("keeps registered rules unique and documented", () => {
  expect(new Set(SUPPORTED_RULES).size).toBe(SUPPORTED_RULES.length);
  expect(RULES.map((rule) => rule.id)).toEqual(SUPPORTED_RULES);
  const reference = readFileSync(
    new URL("../REFERENCE.md", import.meta.url),
    "utf8",
  );
  for (const rule of RULES) {
    expect(rule.description.length).toBeGreaterThan(0);
    expect(reference).toMatch(new RegExp(`\\| ${rule.id} +\\|`));
  }
});
