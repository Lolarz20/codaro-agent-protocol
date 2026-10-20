import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this gate through npm run pack:check');
const run = (exe, args, cwd = process.cwd()) => execFileSync(exe, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('artifacts', { recursive: true });
const packed = JSON.parse(run(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', 'artifacts']))[0];
const archive = resolve('artifacts', packed.filename);
const bytes = gunzipSync(readFileSync(archive));
const allowed = /^package\/(?:package\.json|README\.md|LICENSE|NOTICE|CHANGELOG\.md|dist\/[\w/.-]+\.(?:js|d\.ts)|docs\/[\w/.-]+\.(?:md|json)|examples\/[\w/.-]+\.mjs)$/;
// Fixed-width tar headers are enough for npm's restricted, short public paths.
for (let p = 0; p + 512 <= bytes.length && bytes[p];) {
  const header = bytes.subarray(p, p + 512);
  const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
  const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0;
  if (!allowed.test(name) || name.includes('..')) throw new Error('Unexpected packed path: ' + name);
  const content = bytes.subarray(p + 512, p + 512 + size).toString('utf8');
  const forbidden = [/gw[.]codaro/i, /codaro[.]dev/i, /[A-Z]:\\Users\\/i, /\/Users\/[^/]+\//, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /gh[pousr]_[A-Za-z0-9]{36}/];
  if (forbidden.some(re => re.test(content))) throw new Error('Sensitive packed content in ' + name);
  p += 512 + Math.ceil(size / 512) * 512;
}
const consumer = mkdtempSync(join(tmpdir(), 'oss-consumer-'));
writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
run(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive], consumer);
const smoke = readFileSync('scripts/consumer.mjs', 'utf8');
writeFileSync(join(consumer, 'smoke.mjs'), smoke);
run(process.execPath, ['smoke.mjs'], consumer);
writeFileSync(join(consumer, 'consumer.mts'), `import * as api from '${pkg.name}';\nconsole.log(api);\n`);
run(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.mts'], consumer);
if (!existsSync(join(consumer, 'node_modules', pkg.name, 'dist/index.d.ts'))) throw new Error('Missing declarations');
writeFileSync('artifacts/SHA256SUMS', createHash('sha256').update(readFileSync(archive)).digest('hex') + '  ' + packed.filename + '\n');
console.log(`Package allowlist, content scan, consumer runtime and declarations PASS: ${packed.filename} (${packed.files.length} files)`);
