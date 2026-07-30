import { createRemoteKnowledgeAdapter } from './src/services/knowledge-data/remote-knowledge-adapter.js';

const log = (s) => process.stdout.write(String(s) + '\n');

// 从 .env 自动加载（remote-knowledge-adapter 已 import 'dotenv/config'）
const adapter = createRemoteKnowledgeAdapter({});

log(`enabled=${adapter.enabled}`);

// common 场景远程检索
const r = await adapter.search({
  skill_key: 'common',
  query: '老人高龄津贴怎么申请需要什么材料',
  limit: 3,
});
log(`skill_key=${r.skill_key}`);
log(`status=${r.status} source=${r.source}`);
log(`collections=${JSON.stringify(r.collections)}`);
log(`matches=${r.matches?.length || 0}`);
log(`remote_error=${r.error || ''}`);
log(`remote_http_status=${r.remote_http_status || ''}`);
for (const m of (r.matches || []).slice(0, 3)) {
  log(`  - [${m.collection}] ${m.title} :: ${(m.text || '').slice(0, 40)} (score=${m.score})`);
}
