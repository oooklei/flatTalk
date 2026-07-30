import { identifyScene } from './src/core/scene-router/index.js';

const msg = '老人最近血压偏高，帮我做健康风险预警';
const r = identifyScene({ message: msg, role: 'care_worker' });
console.log('scene=' + r.scene_key + ' decision=' + r.decision + ' intent=' + r.intent);
console.log('cands=' + (r.candidates || []).map((c) => `${c.scene_key}:${c.decision}:${c.confidence}`).join(' | '));
