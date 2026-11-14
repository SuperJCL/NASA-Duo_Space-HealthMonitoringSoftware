// Validate MyoMars messages against the shared contracts v1 — no relay needed.
//   npm run contracts:validate -- path/to/message.json [more.json ...]
//   npm run contracts:validate -- --delivered path/to/delivered.json
// A file may hold one envelope or an array of envelopes. Exit code 1 if any is invalid.
import { readFileSync } from "node:fs";
import { parseEnvelope, parseIncoming } from "../../src/contracts/envelope.ts";

const args = process.argv.slice(2);
const delivered = args.includes("--delivered");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: npm run contracts:validate -- [--delivered] <file.json> [...]");
  process.exit(2);
}
let bad = 0;
for (const f of files) {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    console.log(`INVALID  ${f}: not readable JSON (${(e as Error).message})`);
    bad++;
    continue;
  }
  const items = Array.isArray(data) ? data : [data];
  items.forEach((item, i) => {
    const r = delivered ? parseIncoming(item) : parseEnvelope(item);
    const where = items.length > 1 ? `${f}[${i}]` : f;
    if (r.ok) console.log(`OK       ${where}: ${r.value.type} ${r.value.eventId}`);
    else {
      bad++;
      console.log(`INVALID  ${where}: ${r.code} — ${r.message.replaceAll("\n", " ")}`);
    }
  });
}
process.exit(bad ? 1 : 0);
