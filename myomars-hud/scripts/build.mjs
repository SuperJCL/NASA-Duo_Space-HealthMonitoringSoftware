// Build: copy the static HUD + contract + mock base into dist/ (no bundler needed; plain ES modules).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const files = ['hud.html', 'hud/base-client.js', 'assets/mars-pano-360.webp', 'contract/draft-v0.1.md',
  'contract/samples/retest-result.sample.json', 'contract/samples/walking-segment.sample.json', 'server/mock-base.mjs', 'server/console.html', 'package.json', 'README.md', 'start-base.command'];
fs.rmSync(OUT, { recursive: true, force: true });
let bytes = 0;
for (const f of files) {
  const src = path.join(ROOT, f), dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); fs.chmodSync(dst, fs.statSync(src).mode); bytes += fs.statSync(dst).size;
  console.log('  ' + f);
}
console.log(`dist/ ready: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB. Run: cd dist && node server/mock-base.mjs`);
