import 'dotenv/config';

const BASE = process.env.FLATTALK_KB_BASE_URL || 'http://43.138.143.130:9015';
const USER = process.env.FLATTALK_KB_USERNAME;
const PASS = process.env.FLATTALK_KB_PASSWORD;
const SPACE = Number(process.env.FLATTALK_KB_SPACE || 23);
const AGENT = process.env.FLATTALK_KB_AGENT_ID || '373';
const log = (s) => process.stdout.write(String(s) + '\n');

const loginRes = await fetch(`${BASE}/api/user/passwordLogin`, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ phoneOrEmail: USER, emailOrPhone: USER, username: USER, password: PASS }),
});
const setCookie = loginRes.headers.get('set-cookie') || '';
const cookieTicket = (setCookie.match(/ticket=([^;]+)/) || [])[1] || '';
const loginJson = await loginRes.json().catch(() => ({}));
const bearer = loginJson?.data?.token || '';
log(`LOGIN status=${loginRes.status} bearer?=${!!bearer} cookieTicket?=${!!cookieTicket}`);

const hBearer = { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) };
const hCookie = { 'Content-Type': 'application/json', ...(cookieTicket ? { cookie: `ticket=${cookieTicket}` } : {}) };

// list with Bearer
const listRes = await fetch(`${BASE}/api/knowledge/config/list`, {
  method: 'POST', headers: hBearer,
  body: JSON.stringify({ spaceId: SPACE, pageNo: 1, pageSize: 100 }),
});
const listJson = await listRes.json();
const records = listJson?.data?.records || [];
const policyKb = records.find((r) => r.id === 179) || records.find((r) => r.name === '广西养老政策知识库');
const dietKb = records.find((r) => r.id === 181) || records.find((r) => r.name === '膳食知识库');
log(`policyKb=${policyKb?.id} dietKb=${dietKb?.id}`);

const payload = (kbId, name) => ({
  kbId,
  name,
  dataType: 1,
  fileContent: '广西高龄津贴：年满80周岁可申领高龄津贴，需持身份证、户口本、银行卡到户籍地社区居委会办理，审核通过后按月发放。',
  spaceId: SPACE,
  segment: { segment: 'WORDS', words: 1000, overlaps: 10, delimiter: null, isTrim: true },
});

if (policyKb) {
  // A: Bearer
  const aRes = await fetch(`${BASE}/api/knowledge/document/add`, { method: 'POST', headers: hBearer, body: JSON.stringify(payload(policyKb.id, `zzz_BEARER_${Date.now()}`)) });
  const aJson = await aRes.json().catch(() => ({}));
  log(`ADD_BEARER status=${aRes.status} code=${aJson?.code} success=${aJson?.success} msg=${aJson?.message}`);
  // B: Cookie
  const bRes = await fetch(`${BASE}/api/knowledge/document/add`, { method: 'POST', headers: hCookie, body: JSON.stringify(payload(policyKb.id, `zzz_COOKIE_${Date.now()}`)) });
  const bJson = await bRes.json().catch(() => ({}));
  log(`ADD_COOKIE status=${bRes.status} code=${bJson?.code} success=${bJson?.success} msg=${bJson?.message}`);
}
