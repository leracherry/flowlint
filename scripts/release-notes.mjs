import { readFileSync, writeFileSync } from "node:fs";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const sections = readFileSync("CHANGELOG.md", "utf8").split(/^## /m);
const notes = sections.find((section) => section.startsWith(`${version} `));
if (!notes) throw new Error(`Missing changelog for ${version}`);
writeFileSync("release/notes.md", `## ${notes.trim()}\n`);
