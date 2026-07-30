import { createRemoteKnowledgeAdapter } from './src/services/knowledge-data/remote-knowledge-adapter.js';

const a = createRemoteKnowledgeAdapter({});
// 直接搜索测试文档的独特标题，确认向量化是否自动完成
const r1 = await a.search({ skill_key: 'common', query: 'zzz_TEST_179', limit: 5 });
console.log('POLICY_TEST_DOC=', JSON.stringify((r1.matches || []).map((m) => ({ title: m.title, c: m.collection, s: m.score })), null, 2));
const r2 = await a.search({ skill_key: 'meal_plan', query: 'zzz_TEST_181', limit: 5 });
console.log('DIET_TEST_DOC=', JSON.stringify((r2.matches || []).map((m) => ({ title: m.title, c: m.collection, s: m.score })), null, 2));
