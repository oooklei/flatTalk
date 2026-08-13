/**
 * One-off probe for https://api.fliggy.net/vacation
 * Credentials via env only: FLIGGY_VACATION_USER / FLIGGY_VACATION_PASS
 * Does not print password.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'scripts/test-output/fliggy-vacation-probe');
fs.mkdirSync(OUT, { recursive: true });

const USER = process.env.FLIGGY_VACATION_USER || '';
const PASS = process.env.FLIGGY_VACATION_PASS || '';
const BASE = 'https://api.fliggy.net';

const jar = new Map(); // name -> value

function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  const single = res.headers.get('set-cookie');
  const list = raw.length ? raw : (single ? [single] : []);
  for (const line of list) {
    const part = String(line).split(';')[0];
    const eq = part.indexOf('=');
    if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function req(method, url, { body, headers = {}, form } = {}) {
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) flatTalk-probe',
    Accept: 'application/json, text/plain, */*',
    ...headers,
  };
  const c = cookieHeader();
  if (c) h.Cookie = c;
  let payload;
  if (form) {
    payload = new URLSearchParams(form).toString();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!h['Content-Type']) h['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers: h, body: payload, redirect: 'manual' });
  storeCookies(res);
  const text = await res.text();
  return { status: res.status, headers: Object.fromEntries(res.headers), text, url };
}

function save(name, data) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
  return p;
}

function redact(obj) {
  const s = JSON.stringify(obj);
  return s.replace(new RegExp(PASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
}

console.log('=== Fliggy vacation probe ===');
console.log('user_set:', Boolean(USER), 'pass_set:', Boolean(PASS), 'user_tail:', USER.slice(-4));

const report = { steps: [], cookieNames: [] };

// 1) GET landing
{
  const r = await req('GET', `${BASE}/vacation`);
  report.steps.push({
    step: 'GET /vacation',
    status: r.status,
    location: r.headers.location || r.headers.Location,
    bytes: r.text.length,
    contentType: r.headers['content-type'],
  });
  save('01-vacation.html', r.text);
  const title = (r.text.match(/<title[^>]*>([^<]*)/i) || [])[1];
  const scripts = [...r.text.matchAll(/src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 40);
  save('01-meta.json', { title, scripts, head: r.text.replace(/\s+/g, ' ').slice(0, 1200) });
  console.log('1) GET /vacation', r.status, 'title=', title, 'bytes=', r.text.length);
}

// 2) common login path guesses
const loginCandidates = [
  { method: 'POST', url: `${BASE}/vacation/login`, json: { username: USER, password: PASS, account: USER, mobile: USER } },
  { method: 'POST', url: `${BASE}/vacation/api/login`, json: { username: USER, password: PASS, account: USER, mobile: USER } },
  { method: 'POST', url: `${BASE}/vacation/user/login`, json: { username: USER, password: PASS } },
  { method: 'POST', url: `${BASE}/api/vacation/login`, json: { username: USER, password: PASS, mobile: USER } },
  { method: 'POST', url: `${BASE}/vacation/passport/login`, json: { loginId: USER, password: PASS } },
  { method: 'POST', url: `${BASE}/vacation/login.do`, form: { username: USER, password: PASS, account: USER } },
];

for (let i = 0; i < loginCandidates.length; i++) {
  const c = loginCandidates[i];
  if (!USER || !PASS) break;
  try {
    const r = await req(c.method, c.url, c.form ? { form: c.form } : { body: c.json });
    const snippet = r.text.replace(/\s+/g, ' ').slice(0, 500);
    const step = {
      step: `login_try_${i + 1}`,
      url: c.url,
      status: r.status,
      location: r.headers.location || r.headers.Location,
      snippet,
    };
    report.steps.push(step);
    save(`02-login-try-${i + 1}.txt`, redact({ status: r.status, headers: r.headers, body: r.text.slice(0, 4000) }));
    console.log(`2.${i + 1})`, c.url, '->', r.status, snippet.slice(0, 160));
    // stop early if looks like success JSON
    if (r.status >= 200 && r.status < 300 && /token|success|true|userInfo|session/i.test(r.text) && !/password|error|fail|错误|失败/i.test(snippet)) {
      console.log('  ^ possible success, continue probing with cookies');
      break;
    }
  } catch (e) {
    report.steps.push({ step: `login_try_${i + 1}`, url: c.url, error: String(e.message || e) });
    console.log(`2.${i + 1})`, c.url, 'ERR', e.message);
  }
}

report.cookieNames = [...jar.keys()];
console.log('cookies:', report.cookieNames.join(',') || '(none)');

// 3) After cookies, try a few resource endpoints
const afterLoginGets = [
  `${BASE}/vacation/`,
  `${BASE}/vacation/api/user/info`,
  `${BASE}/vacation/api/product/list`,
  `${BASE}/vacation/api/route/list`,
  `${BASE}/vacation/home`,
];
for (let i = 0; i < afterLoginGets.length; i++) {
  const url = afterLoginGets[i];
  try {
    const r = await req('GET', url);
    report.steps.push({
      step: `get_${i + 1}`,
      url,
      status: r.status,
      bytes: r.text.length,
      snippet: r.text.replace(/\s+/g, ' ').slice(0, 300),
    });
    save(`03-get-${i + 1}.txt`, r.text.slice(0, 8000));
    console.log(`3.${i + 1})`, url, '->', r.status, 'bytes=', r.text.length);
  } catch (e) {
    report.steps.push({ step: `get_${i + 1}`, url, error: String(e.message || e) });
  }
}

save('REPORT.json', report);
console.log('=== done ===');
console.log('out_dir:', OUT);
console.log('(password never written to report)');
