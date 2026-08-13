/**
 * Probe Fliggy merchant login (mac.fliggy.net) + vacation open docs.
 * Env: FLIGGY_VACATION_USER / FLIGGY_VACATION_PASS — never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/test-output/fliggy-vacation-probe');
fs.mkdirSync(OUT, { recursive: true });

const USER = process.env.FLIGGY_VACATION_USER || '';
const PASS = process.env.FLIGGY_VACATION_PASS || '';

const jar = new Map();
function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const single = res.headers.get('set-cookie');
  const list = raw.length ? raw : single ? [single] : [];
  for (const line of list) {
    const part = String(line).split(';')[0];
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function req(method, url, opts = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    Accept: 'application/json, text/html, */*',
    ...(opts.headers || {}),
  };
  const c = cookieHeader();
  if (c) headers.Cookie = c;
  let body;
  if (opts.form) {
    body = new URLSearchParams(opts.form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body, redirect: 'manual' });
  storeCookies(res);
  const text = await res.text();
  return { status: res.status, headers: Object.fromEntries(res.headers), text, url };
}
function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
}

const report = { note: 'api.fliggy.net/vacation is open-platform docs SPA (trip/fopen)', steps: [] };
console.log('user_tail', USER.slice(-4), 'pass_set', Boolean(PASS));

// A) docs schemas
for (const name of ['line', 'ticket', 'play', 'point']) {
  const url = `https://cdn.fliggy.com/api_schema/27/${name}.json`;
  const r = await req('GET', url);
  save(`schema-${name}.json`, r.text.slice(0, 200000));
  let keys = [];
  try { keys = Object.keys(JSON.parse(r.text)).slice(0, 20); } catch {}
  report.steps.push({ step: `schema_${name}`, status: r.status, bytes: r.text.length, topKeys: keys });
  console.log('schema', name, r.status, 'bytes', r.text.length, 'keys', keys.join(','));
}

// B) login portal
{
  const returnUrl = encodeURIComponent('https://api.fliggy.net/vacation');
  const url = `https://mac.fliggy.net/login#/login?returnUrl=${returnUrl}`;
  const r = await req('GET', `https://mac.fliggy.net/login`);
  save('mac-login.html', r.text);
  report.steps.push({ step: 'GET mac.fliggy.net/login', status: r.status, bytes: r.text.length, hashHint: url });
  console.log('mac login page', r.status, r.text.length);
  const title = (r.text.match(/<title[^>]*>([^<]*)/i) || [])[1];
  console.log('title', title);
  const scripts = [...r.text.matchAll(/src=["']([^"']+)["']/gi)].map((m) => m[1]);
  save('mac-login-meta.json', { title, scripts: scripts.slice(0, 30), head: r.text.replace(/\s+/g, ' ').slice(0, 1500) });
}

// C) try common merchant/havana style login endpoints (may fail without captcha/token)
const tries = [
  {
    name: 'ipassport_login_json',
    method: 'POST',
    url: 'https://ipassport.fliggy.net/member/login.do',
    form: {
      loginId: USER,
      password: PASS,
      loginType: '3',
      site: '89',
    },
  },
  {
    name: 'mac_api_login',
    method: 'POST',
    url: 'https://mac.fliggy.net/api/login',
    json: { loginId: USER, password: PASS, mobile: USER },
  },
  {
    name: 'api_switch_open',
    method: 'GET',
    url: 'https://api-switch.fliggy.net/api/xapi/api/open/v1',
  },
  {
    name: 'space_home',
    method: 'GET',
    url: 'https://api.fliggy.net/space',
  },
];

for (const t of tries) {
  try {
    const r = await req(t.method, t.url, t.form ? { form: t.form } : t.json !== undefined ? { json: t.json } : {});
    const snippet = r.text.replace(/\s+/g, ' ').slice(0, 400);
    report.steps.push({
      step: t.name,
      url: t.url,
      status: r.status,
      location: r.headers.location || r.headers.Location,
      snippet,
      cookies: [...jar.keys()],
    });
    save(`try-${t.name}.txt`, r.text.slice(0, 6000));
    console.log(t.name, '->', r.status, snippet.slice(0, 180));
  } catch (e) {
    report.steps.push({ step: t.name, error: String(e.message || e) });
    console.log(t.name, 'ERR', e.message);
  }
}

save('REPORT-login.json', report);
console.log('cookies', [...jar.keys()].join(',') || '(none)');
console.log('done', OUT);
