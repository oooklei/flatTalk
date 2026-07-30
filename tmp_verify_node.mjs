import { createRemoteKnowledgeAdapter } from './src/services/knowledge-data/remote-knowledge-adapter.js';

const a = createRemoteKnowledgeAdapter({});
const r1 = await a.search({ skill_key: 'common', query: '高龄津贴怎么申请', limit: 5 });
console.log('COMMON_matches=', JSON.stringify((r1.matches || []).map((m) => ({ title: m.title, c: m.collection, s: m.score })), null, 2));
const r2 = await a.search({ skill_key: 'meal_plan', query: '高血压低盐饮食', limit: 5 });
console.log('MEAL_matches=', JSON.stringify((r2.matches || []).map((m) => ({ title: m.title, c: m.collection, s: m.score })), null, 2));
