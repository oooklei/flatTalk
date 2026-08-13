import { identifyScene } from '../src/core/scene-router/index.js';

const tests = [
  '旅居规划',
  '帮我规划旅居路线',
  '推荐适合老人的早餐',
  '查看派单列表',
  '老人有什么补贴',
  '推荐养老服务',
  '老人健康风险预警',
];

for (const text of tests) {
  const r = identifyScene(text);
  const top3 = (r.candidates || []).slice(0, 3).map(c => ({
    scene: c.scene_key,
    conf: c.confidence.toFixed(2),
    score: c.score.toFixed(1),
    dec: c.decision,
  }));
  console.log(`[${text}] → routed=${r.routed} scene=${r.scene_key} intent=${r.intent} conf=${r.confidence.toFixed(2)} top3=${JSON.stringify(top3)}`);
}
