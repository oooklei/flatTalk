import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/test-output/fliggy-vacation-probe');
fs.mkdirSync(OUT, { recursive: true });
const umiPath = path.join(OUT, 'umi.js');

const url = 'https://g.alicdn.com/trip/fopen/1.3.10/umi.js';
console.log('download', url);
const res = await fetch(url);
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(umiPath, buf);
console.log('status', res.status, 'bytes', buf.length);

const t = buf.toString('utf8');
const urls = new Set();
for (const m of t.matchAll(/https?:\/\/[a-zA-Z0-9._\-/:?=&%#+]+/g)) urls.add(m[0]);
const interesting = [...urls].filter((u) =>
  /login|oauth|passport|vacation|fopen|fliggy|api\.|mtop|alibaba|taobao|havana|sso|auth|user|product|route|travel|open/i.test(u),
);
fs.writeFileSync(path.join(OUT, 'umi-urls.json'), JSON.stringify(interesting, null, 2));
console.log('interesting_urls', interesting.length);
interesting.slice(0, 100).forEach((u) => console.log(u));

const pathHits = new Set();
for (const m of t.matchAll(/["'`](\/[a-zA-Z0-9_\-./?=&%]{2,160})["'`]/g)) {
  const p = m[1];
  if (/login|oauth|passport|vacation|user|product|route|auth|session|api|fopen/i.test(p)) pathHits.add(p);
}
fs.writeFileSync(path.join(OUT, 'umi-paths.json'), JSON.stringify([...pathHits], null, 2));
console.log('--- path hints', pathHits.size, '---');
[...pathHits].slice(0, 120).forEach((p) => console.log(p));

// chunk references
const chunks = [...t.matchAll(/static\/js\/[a-zA-Z0-9.\-]+\.js/g)].map((m) => m[0]);
console.log('chunk_refs', [...new Set(chunks)].slice(0, 40));
