import 'dotenv/config';

const BASE = process.env.FLATTALK_KB_BASE_URL || 'http://43.138.143.130:9015';
const USER = process.env.FLATTALK_KB_USERNAME;
const PASS = process.env.FLATTALK_KB_PASSWORD;
const SPACE = Number(process.env.FLATTALK_KB_SPACE || 23);
const AGENT = process.env.FLATTALK_KB_AGENT_ID || '373';
const log = (s) => process.stdout.write(String(s) + '\n');

// 1. login（复刻 adapter：body 含 emailOrPhone/username，ticket 取 set-cookie）
const loginRes = await fetch(`${BASE}/api/user/passwordLogin`, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ phoneOrEmail: USER, emailOrPhone: USER, username: USER, password: PASS }),
});
const setCookie = loginRes.headers.get('set-cookie') || '';
const cookieTicket = (setCookie.match(/ticket=([^;]+)/) || [])[1] || '';
const loginJson = await loginRes.json().catch(() => ({}));
const token = cookieTicket || loginJson?.data?.ticket || loginJson?.data?.token || '';
log(`LOGIN status=${loginRes.status} ticket?=${!!token}`);
const headers = { 'Content-Type': 'application/json', ...(token ? { cookie: `ticket=${token}` } : {}) };

// 2. config/list
const listRes = await fetch(`${BASE}/api/knowledge/config/list`, {
  method: 'POST', headers,
  body: JSON.stringify({ spaceId: SPACE, pageNo: 1, pageSize: 100 }),
});
const listJson = await listRes.json();
const records = listJson?.data?.records || listJson?.data?.list || [];
log(`KB_COUNT=${records.length}`);
for (const r of records) log(`  - id=${r.id} name="${r.name}" dataType=${r.dataType} emb=${r.embeddingModelId} status=${r.status}`);

const policyKb = records.find((r) => r.name === '广西养老政策知识库');
const dietKb = records.find((r) => r.name === '膳食知识库');
log(`policyKb=${policyKb?.id} dietKb=${dietKb?.id}`);

// 3. document/add（文本）验证解析
if (policyKb) {
  const name = `zzz_PROBE_${Date.now()}`;
  const addRes = await fetch(`${BASE}/api/knowledge/document/add`, {
    method: 'POST', headers,
    body: JSON.stringify({
      kbId: policyKb.id,
      name,
      dataType: 1,
      fileContent: '广西高龄津贴：老年人年满80周岁可申领高龄津贴，需持身份证、户口本、银行卡到户籍地社区居委会办理，审核通过后按月发放至本人银行账户。',
      spaceId: SPACE,
      segment: { segment: 'WORDS', words: 1000, overlaps: 10, delimiter: null, isTrim: true },
    }),
  });
  const addJson = await addRes.json();
  log(`ADD status=${addRes.status} code=${addJson?.code} success=${addJson?.success} msg=${addJson?.message}`);
  await new Promise((r) => setTimeout(r, 2000));
  // 4. query 验证可搜索
  const qRes = await fetch(`${BASE}/api/knowledge/query`, {
    method: 'POST', headers,
    body: JSON.stringify({ collection: '广西养老政策知识库', query: '高龄津贴怎么申请', top_k: 3, filter: {}, min_score: 0, spaceId: SPACE, agentId: AGENT }),
  });
  const qJson = await qRes.json();
  const matches = qJson?.data?.matches || qJson?.matches || [];
  log(`QUERY status=${qRes.status} matches=${matches.length}`);
  for (const m of matches.slice(0, 3)) log(`  - [${m.collection}] ${m.title || m.name} score=${m.score}`);
}
