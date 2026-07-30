const BASE = 'http://127.0.0.1:5298';

async function chat(message, role = 'care_worker', extra = {}) {
  const res = await fetch(`${BASE}/api/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, role, conversation_id: 'conv_http_1', turn_id: 'turn_http_1', ...extra }),
  });
  return res.json();
}

function log(t) { console.log(t); }

// 1. 健康风险预警主流程
const r1 = await chat('老人最近血压偏高，帮我做健康风险预警', 'care_worker');
log('=== 主流程 ===');
log(`ok=${r1.ok} skill_key=${r1.skill_key} template_id=${r1.template_id} error=${r1.error || ''} message=${r1.message || ''}`);
log('FULL1=' + JSON.stringify(r1).slice(0, 600));
log(`card.templateId=${r1.card?.templateId} render_status=${r1.render_status}`);
log(`html_has_card=${String(r1.rendered_html).includes('health-warning-card')}`);
log(`actions=${(r1.actions || []).map((a) => a.action_key).join(',')}`);

// 2. 知识检索
try {
  const kb = await fetch(`${BASE}/api/data/knowledge/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill_key: 'health_risk_warning', query: '健康风险预警 血压 规则', limit: 3 }),
  }).then((x) => x.json());
  log('=== 知识检索 ===');
  log(`source=${kb.source} matches=${kb.matches?.length}`);
} catch (e) {
  log('KB ERR ' + e.message);
}

// 3. 跌倒风险（应急等级）
const r3 = await chat('老人夜里多次离床，有跌倒风险，需要预警研判', 'village_doctor');
log('=== 跌倒风险 ===');
log(`ok=${r3.ok} skill_key=${r3.skill_key} template_id=${r3.template_id} html_has_card=${String(r3.rendered_html).includes('health-warning-card')}`);

// 4. 纯膳食请求不应被健康吞掉
const r4 = await chat('给老人推荐今日控糖低盐晚餐', 'care_worker');
log('=== 纯膳食 ===');
log(`skill_key=${r4.skill_key}`);

// 5. 高血压晚餐推荐应回落 meal_plan（不抢食）
const r5 = await chat('高血压老人晚餐推荐', 'care_worker');
log('=== 高血压晚餐推荐 ===');
log(`skill_key=${r5.skill_key}`);
