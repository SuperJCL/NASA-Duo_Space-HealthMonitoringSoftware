// Writes the language-neutral contract files from the Zod sources:
//   node tools/myomars/build-contracts.ts          (write)
//   node tools/myomars/build-contracts.ts --check  (exit 1 if the committed files are out of date)
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateContractFiles } from "./generate-contracts.ts";

const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const files = generateContractFiles();
const check = process.argv.includes("--check");
let stale = 0;
for (const [rel, content] of Object.entries(files)) {
  const abs = join(root, rel);
  const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  if (current === content) continue;
  stale++;
  if (check) console.error(`out of date: ${rel}`);
  else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}
// Files in the generated folders that the sources no longer produce.
for (const dir of ["contracts/schema", "contracts/examples", "contracts/scenarios"]) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const f of readdirSync(abs)) {
    const rel = `${dir}/${f}`;
    if (files[rel] !== undefined) continue;
    stale++;
    if (check) console.error(`no longer generated: ${rel}`);
    else rmSync(join(root, rel));
  }
}
if (check && stale) {
  console.error(`${stale} contract file(s) out of date: run "npm run contracts:build"`);
  process.exit(1);
}
console.log(check ? `contracts up to date (${Object.keys(files).length} files)` : `wrote contract files (${stale} changed, ${Object.keys(files).length} total)`);
