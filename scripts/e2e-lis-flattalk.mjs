// flatTalk ↔ LIS 端到端联调验证。
//
// 重点验证本次改动的三条链路：
//   1. LIS 命中 → 下发 template_id → flatTalk 直接渲染该模板
//      （不再经 INTENT_TEMPLATE_MAP，那份第二映射表已删除）
//   2. 锚点原子化后的细分意图能拿到正确的细分卡
//      （早餐→diet_breakfast_card 而非 diet_card 全天卡）
//   3. 扁平化后的 common 模板仍可渲染（policy/answer 走 templates/html/ 单层）
import fs from 'node:fs';

const FLATTALK = 'http://127.0.0.1:5298';
const LIS = 'http://127.0.0.1:8100';

// 每条：话语 / 期望意图 / 期望模板（来自 catalog 的 1:1 绑定）
const CASES = [
  ['早餐吃什么好', 'meal_plan_breakfast_advice', 'diet_breakfast_card'],
  ['周边有药店吗', 'nearby_resource.medical', 'nearby_medical_card'],
  ['看下这个工单详情', 'dispatch_detail', 'dispatch_detail'],
  ['帮我看看舌诊详情', 'health_risk_warning.tongue', 'tongue_diagnosis_card'],
  ['一周的膳食计划', 'meal_plan_weekly_plan', 'weekly_plan'],
  ['这条线路要多少钱', 'travel_route_budget', 'travel_budget_card'],
  ['护工的档案给我看看', 'find_service_worker', 'worker_profile'],
  ['有什么补贴政策', 'elder_policy_consult', 'policy_card'],
  ['附近有什么好吃的', 'nearby_resource.food', 'nearby_food_card'],
];

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

const lines = [];
let cidSeq = 0;
let lisOk = 0;
let chatOk = 0;
let tplOk = 0;

lines.push('=== 阶段一：LIS 直接调用（意图 + template_id 下发）===');
const lisResults = new Map();
for (const [utt, wantIntent, wantTpl] of CASES) {
  const { status, json } = await post(`${LIS}/v1/sort`, {
    utterance: utt,
    context: { role: 'elder', session_id: 'e2e-lis' },
  });
  const top = (json?.intents || [])[0] || {};
  const gotIntent = top.intent_id || '';
  const gotTpl = top.template_id || '';
  lisResults.set(utt, { gotIntent, gotTpl });
  const iOk = gotIntent === wantIntent;
  const tOk = gotTpl === wantTpl;
  if (iOk) lisOk += 1;
  if (tOk) tplOk += 1;
  lines.push(
    `${iOk && tOk ? 'OK ' : '!! '}${utt}`
    + `\n     意图 ${iOk ? '✓' : '✗'} got=${gotIntent} want=${wantIntent}`
    + `\n     模板 ${tOk ? '✓' : '✗'} got=${gotTpl} want=${wantTpl}  (http ${status})`,
  );
}

lines.push('');
lines.push('=== 阶段二：flatTalk /api/chat/message 端到端（渲染出卡）===');
for (const [utt, wantIntent, wantTpl] of CASES) {
  // 每条必须用**全局唯一**的 conversation_id。
  // 早期用 Math.random() 拼接，实测出现过串扰：上一轮"对比目的地"的
  // 上下文被继承，导致「这条线路要多少钱」出 route_compare_card 而非
  // travel_budget_card —— 是脚本缺陷，不是产品 bug（单独请求可复现正确）。
  const cid = `e2e-${process.pid}-${Date.now()}-${cidSeq++}`;
  const { status, json, text } = await post(`${FLATTALK}/api/chat/message`, {
    message: utt,
    conversation_id: cid,
    role: 'elder',
  });
  if (status !== 200 || !json) {
    lines.push(`!! ${utt}  http=${status} body=${text.slice(0, 200)}`);
    continue;
  }
  // 模板与意图可能挂在不同层级，逐一探查
  const usedTpl = json.template_id || json.card?.template_id || json.render?.template_id
    || json.data?.template_id || json.result?.template_id || '';
  const usedIntent = json.intent || json.intent_id || json.scene?.intent
    || json.debug?.intent || json.data?.intent || '';
  const hasHtml = Boolean(
    json.rendered_html || json.card?.rendered_html || json.html || json.data?.rendered_html,
  );
  const ok = usedTpl === wantTpl;
  if (ok) chatOk += 1;
  lines.push(
    `${ok ? 'OK ' : '!! '}${utt}`
    + `\n     intent=${usedIntent || '(未回报)'} template=${usedTpl || '(未回报)'} want=${wantTpl}`
    + `\n     有HTML=${hasHtml} http=${status}`,
  );
  if (!ok) {
    lines.push(`     顶层字段: ${Object.keys(json).slice(0, 22).join(', ')}`);
  }
}

lines.push('');
lines.push(`LIS 意图命中     : ${lisOk}/${CASES.length}`);
lines.push(`LIS template_id  : ${tplOk}/${CASES.length}`);
lines.push(`flatTalk 模板一致: ${chatOk}/${CASES.length}`);

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/e2e-report.txt', lines.join('\n'), 'utf8');
console.log(`lis=${lisOk}/${CASES.length} tpl=${tplOk}/${CASES.length} chat=${chatOk}/${CASES.length}`);
