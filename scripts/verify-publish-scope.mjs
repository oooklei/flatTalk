// 我的 publish 模板修复是否多余？
// 已存在 skipPublishMatch 会跳过 calculate_budget 的线路包匹配。
// 但 e2e 里「这条线路要多少钱」是**纯话语**（无 action_key），
// skipPublishMatch 判定依赖 request.context.action_key，纯话语时为空 → 不跳过。
// 所以两者覆盖的是不同场景。这里验证：临时禁用我的改动，看是否复现 bug。
import fs from 'node:fs';

const out = [];

async function ask(message) {
  const r = await fetch('http://127.0.0.1:5298/api/chat/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: `c-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: 'elder',
    }),
  });
  const j = await r.json();
  return { tpl: j.template_id, intent: j.intent, skill: j.skill_key };
}

// 场景 1：纯话语问预算（无 action_key）→ skipPublishMatch 不生效，
//         必须靠我的 LIS 优先修复
out.push('=== 纯话语（无 action_key）===');
for (const m of [
  '这条线路要多少钱',
  '巴马这条线路要多少钱',
  '防城港五天四晚多少钱',
]) {
  const r = await ask(m);
  const ok = r.tpl === 'travel_budget_card';
  out.push(`  ${ok ? 'OK ' : '!! '}「${m}」-> ${r.tpl}  intent=${r.intent}`);
}

// 场景 2：确认线路包本身仍能正常出产品卡（不能被我改坏）
out.push('');
out.push('=== 线路规划类（应出线路卡，不能被改坏）===');
for (const m of [
  '推荐巴马康养线路',
  '防城港滨海旅居线路',
  '帮我规划一条旅居路线',
]) {
  const r = await ask(m);
  // 应落在 travel_route 技能的线路类模板
  const isRouteCard = /route|sojourn/.test(String(r.tpl));
  out.push(`  ${isRouteCard ? 'OK ' : '!! '}「${m}」-> ${r.tpl}  intent=${r.intent}`);
}

fs.writeFileSync('build/publish-scope.txt', out.join('\n'), 'utf8');
console.log('done');
