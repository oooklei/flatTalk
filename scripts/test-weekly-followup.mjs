/**
 * 验证追问"生成一周计划"是否正确路由到 weekly_plan 模板
 */
import { templateIdFromAction } from '../src/core/actions/action-dispatcher.js';

// 测试1: templateIdFromAction 导出可用
console.log('== 测试1: templateIdFromAction 导出 ==');
const cases = [
  ['meal_plan.generate_weekly_plan', {}, 'weekly_plan'],
  ['meal_plan.adjust_for_condition', {}, ''],
  ['travel_route.check_availability', {}, 'travel_availability_card'],
  ['sos.call_120', {}, 'service_emergency'],
  ['find_service.catalog', {}, 'service_catalog'],
];
let pass = 0;
for (const [actionKey, params, expected] of cases) {
  const result = templateIdFromAction(actionKey, params);
  const ok = result === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${actionKey} → "${result}" (期望 "${expected}")`);
  if (ok) pass++;
}
console.log(`  ${pass}/${cases.length} 通过\n`);

// 测试2: 模拟 handleChat 的 template_id 解析逻辑
console.log('== 测试2: handleChat template_id 解析（模拟）==');
const reenterChat = false;
const params = {};

function resolveTemplateId(body) {
  const rc = body.reenter_chat === true || body.execute_action === false;
  return body.template_id || body.templateId || body.params?.template_id || body.next_template_id
    || (rc ? '' : templateIdFromAction(body.action_key || body.actionKey || '', body.params || {}));
}

// 场景A: 前端发送 action_key 但没有 template_id（bug 场景）
const bodyA = {
  action_key: 'meal_plan.generate_weekly_plan',
  skill_key: 'meal_plan',
  user_prompt: '请基于这份膳食建议生成一周三餐计划',
  execute_action: true,
  reenter_chat: false,
};
console.log(`  场景A (action_key无template_id): "${resolveTemplateId(bodyA)}" (期望 "weekly_plan")`);

// 场景B: 前端同时发送 template_id 和 action_key
const bodyB = { ...bodyA, template_id: 'weekly_plan' };
console.log(`  场景B (两者都有): "${resolveTemplateId(bodyB)}" (期望 "weekly_plan")`);

// 场景C: reenter_chat=true 时不应推导
const bodyC = { ...bodyA, reenter_chat: true };
console.log(`  场景C (reenter_chat=true): "${resolveTemplateId(bodyC)}" (期望 "")`);

// 场景D: 非 action 按钮（普通追问）
const bodyD = {
  user_prompt: '帮我看一下天气',
  execute_action: false,
  reenter_chat: true,
};
console.log(`  场景D (普通追问): "${resolveTemplateId(bodyD)}" (期望 "")`);

console.log('\n== 测试3: weekly_plan 模板是否存在 ==');
import fs from 'fs';
import path from 'path';
const weeklyHtml = path.join('src', 'skills', 'meal_plan', 'templates', 'html', 'weekly_plan.html');
const weeklyManifest = path.join('src', 'skills', 'meal_plan', 'templates', 'html', 'weekly_plan.manifest.json');
console.log(`  weekly_plan.html: ${fs.existsSync(weeklyHtml) ? '✅ 存在' : '❌ 缺失'} (${fs.existsSync(weeklyHtml) ? fs.statSync(weeklyHtml).size : 0} bytes)`);
console.log(`  weekly_plan.manifest.json: ${fs.existsSync(weeklyManifest) ? '✅ 存在' : '❌ 缺失'}`);

console.log('\n[完成]');
