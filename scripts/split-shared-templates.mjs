#!/usr/bin/env node
/**
 * 按「强制 1:1」拆分共用模板：为每个共用意图生成独立模板。
 *
 * 生成策略：以源模板为基线派生，保留其全部样式令牌（配色/圆角/字体/阴影），
 * 只改标题、manifest 语义描述、示例数据与追问项 —— 保证视觉统一。
 *
 * 每个模板产出 4 个文件（与现有模板一致）：
 *   html/<id>.html            渲染骨架（Mustache 变量）
 *   html/<id>.manifest.json   语义声明（必须存在，否则模板管理不收录）
 *   html/<id>.sample.json     示例数据
 *   followups/<id>.json       追问按钮
 *
 * 幂等：已存在的文件不覆盖，避免重跑丢失人工改动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/**
 * 拆分计划：intent -> 新模板定义。
 * source 为派生基线；title/description 决定卡片语义差异。
 */
const PLAN = [
  // ---- meal_plan：diet_card 写明"一日三餐完整"，单餐问法命中它是语义错配 ----
  { intent: 'meal_plan_breakfast_advice', id: 'diet_breakfast_card', source: 'diet_card', skill: 'meal_plan',
    title: '早餐推荐', mealName: '早餐', emoji: '☀️🌅',
    description: '单餐（早餐）膳食推荐，含菜品/热量/营养要点与控盐提示',
    match: '仅展示早餐单餐推荐的竖向单卡，不含午晚餐' },
  { intent: 'meal_plan_lunch_advice', id: 'diet_lunch_card', source: 'diet_card', skill: 'meal_plan',
    title: '午餐推荐', mealName: '午餐', emoji: '⛅☀️',
    description: '单餐（午餐）膳食推荐，含菜品/热量/营养要点与控盐提示',
    match: '仅展示午餐单餐推荐的竖向单卡，不含早晚餐' },
  { intent: 'meal_plan_dinner_advice', id: 'diet_dinner_card', source: 'diet_card', skill: 'meal_plan',
    title: '晚餐推荐', mealName: '晚餐', emoji: '🌙🌙',
    description: '单餐（晚餐）膳食推荐，含菜品/热量/营养要点与控盐提示',
    match: '仅展示晚餐单餐推荐的竖向单卡，不含早午餐' },
  { intent: 'meal_plan_condition_advice', id: 'diet_condition_card', source: 'diet_card', skill: 'meal_plan',
    title: '按病程调整的膳食', mealName: '', emoji: '🩺',
    description: '针对特定慢病（糖尿病/高血压/痛风等）调整的膳食推荐，突出忌口与替换建议',
    match: '按慢性病病程定制的膳食卡，含忌口清单与食材替换建议' },

  // ---- nearby_resource ----
  { intent: 'nearby_resource.medical', id: 'nearby_medical_card', source: 'nearby_map_overview', skill: 'nearby_resource',
    title: '周边医疗资源', description: '周边医疗资源专项卡：医院/社区卫生/药店分类打点与距离清单',
    match: '仅展示周边医疗类资源（医院、社区卫生服务中心、药店）的地图与清单' },
  { intent: 'nearby_resource.shop', id: 'nearby_shop_card', source: 'nearby_list', skill: 'nearby_resource',
    title: '周边购物', description: '周边购物资源清单：超市/菜市场/便利店，含距离与营业状态',
    match: '仅展示周边购物类资源的清单卡' },
  { intent: 'nearby_resource.transit', id: 'nearby_transit_card', source: 'nearby_map_route', skill: 'nearby_resource',
    title: '周边交通', description: '周边交通出行卡：公交站/地铁/接驳点与步行距离',
    match: '仅展示周边交通站点与出行方式的地图卡' },
  { intent: 'nearby_resource.leisure', id: 'nearby_leisure_card', source: 'nearby_recommend', skill: 'nearby_resource',
    title: '周边休闲', description: '周边休闲娱乐推荐：公园/文化活动/棋牌茶室等适老休闲场所',
    match: '仅展示周边休闲娱乐类场所的推荐卡' },

  // ---- travel_route ----
  { intent: 'travel_route_budget', id: 'travel_budget_card', source: 'travel_plan_summary_card', skill: 'travel_route',
    title: '旅居预算明细', description: '旅居费用预算明细卡：交通/住宿/餐饮/门票分项与合计',
    match: '仅展示费用预算分项与合计的卡片，不含预定入口' },
  { intent: 'travel_route_compare', id: 'route_compare_card', source: 'route_svg', skill: 'travel_route',
    title: '线路对比', description: '多条旅居线路横向对比卡：天数/预算/强度/适配人群并列',
    match: '展示 2-3 条线路横向对比的卡片' },
  { intent: 'travel_route_query', id: 'route_detail_card', source: 'route_svg', skill: 'travel_route',
    title: '线路详情', description: '单条旅居线路详情卡：亮点/适配人群/包含项与注意事项',
    match: '展示单条线路详细介绍的卡片' },

  // ---- common / health ----
  { intent: 'elder_assistant_usage', id: 'assistant_usage_card', source: 'policy_card', skill: 'common',
    title: '助手使用说明', description: '智能助手使用说明卡：能做什么、怎么问、常见问法示例',
    match: '介绍助手自身能力与使用方法的卡片，非政策咨询' },
  { intent: 'health_risk_warning.manual_review', id: 'health_manual_review_card', source: 'health_warning_card', skill: 'health_risk_warning',
    title: '人工复核申请', description: '健康风险人工复核卡：复核状态/负责人/预计回复时间与已提交材料',
    match: '展示人工复核申请状态与进度的卡片，非风险评估结果' },

  // ---- 补拆：审计脚本的 1:1 检查发现 policy_list_card 被 2 个意图共用 ----
  { intent: 'elder_policy_benefit', id: 'policy_benefit_card', source: 'policy_list_card', skill: 'common',
    title: '补贴待遇明细', description: '养老补贴与待遇明细卡：补贴项目/金额标准/发放周期与领取条件',
    match: '展示具体补贴金额与待遇标准的卡片，非政策条目清单' },
];

function findTemplateFile(skill, tplId, ext, sub = 'html') {
  const base = path.join(ROOT, 'src', 'skills', skill, 'templates', sub);
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(fp);
      else if (e.name === `${tplId}${ext}`) return fp;
    }
  }
  return null;
}

const created = [];
const skippedExisting = [];
const metaFixed = [];
const errors = [];

for (const item of PLAN) {
  const srcHtml = findTemplateFile(item.skill, item.source, '.html');
  const srcMan = findTemplateFile(item.skill, item.source, '.manifest.json');
  if (!srcHtml || !srcMan) {
    errors.push(`${item.id}: 找不到源模板 ${item.source}（skill=${item.skill}）`);
    continue;
  }

  const outDir = path.dirname(srcHtml);
  const htmlOut = path.join(outDir, `${item.id}.html`);
  const manOut = path.join(outDir, `${item.id}.manifest.json`);
  const srcSample = findTemplateFile(item.skill, item.source, '.sample.json');
  const sampleOut = path.join(outDir, `${item.id}.sample.json`);
  const followDir = path.join(ROOT, 'src', 'skills', item.skill, 'templates', 'followups');
  const followSrc = path.join(followDir, `${item.source}.json`);
  const followOut = path.join(followDir, `${item.id}.json`);

  if (fs.existsSync(htmlOut)) {
    // HTML 已存在时不重写（避免覆盖人工调整过的样式），
    // 但仍需校正 manifest 元数据 —— 早期版本漏设 man.name，
    // 已生成的 14 个模板都顶着源模板名，必须能被修正。
    if (!DRY && fs.existsSync(manOut)) {
      const cur = JSON.parse(fs.readFileSync(manOut, 'utf8'));
      const want = {
        id: item.id,
        name: item.title,
        description: item.description,
        match: item.match,
        derived_from: item.source,
        intent_id: item.intent,
      };
      let changed = false;
      for (const [k, v] of Object.entries(want)) {
        if (cur[k] !== v) {
          cur[k] = v;
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(manOut, `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
        metaFixed.push(item.id);
        continue;
      }
    }
    skippedExisting.push(item.id);
    continue;
  }

  // --- HTML：派生源模板，仅换 <title>，样式令牌完全保留 ---
  let html = fs.readFileSync(srcHtml, 'utf8');
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${item.title}（由 ${item.source} 派生，样式一致）</title>`,
  );
  // 单餐卡：把 meals 数组循环收敛为单餐，避免渲染出三餐
  if (item.mealName) {
    html = html.replace(
      /"dateBadge": "[^"]*"/,
      `"dateBadge": "今日${item.mealName} · 单餐推荐"`,
    );
  }

  // --- manifest：语义必须与意图一致，这是"共用即错配"的修复点 ---
  const man = JSON.parse(fs.readFileSync(srcMan, 'utf8'));
  man.id = item.id;
  // name 必须一并改写：沿用源模板名会让新卡片顶着旧语义标题
  // （实测 route_compare_card 的 name 仍是"旅居路线SVG示意图"），
  // 而 name 是模板选择器与 admin 列表的展示字段，错了会误导人工选卡。
  man.name = item.title;
  man.description = item.description;
  man.match = item.match;
  man.derived_from = item.source;
  man.intent_id = item.intent;

  if (DRY) { created.push(`${item.id} (dry)`); continue; }

  fs.writeFileSync(htmlOut, html, 'utf8');
  fs.writeFileSync(manOut, `${JSON.stringify(man, null, 2)}\n`, 'utf8');
  if (srcSample && !fs.existsSync(sampleOut)) {
    fs.copyFileSync(srcSample, sampleOut);
  }
  if (fs.existsSync(followSrc) && !fs.existsSync(followOut)) {
    const f = JSON.parse(fs.readFileSync(followSrc, 'utf8'));
    f.template_id = item.id;
    fs.mkdirSync(followDir, { recursive: true });
    fs.writeFileSync(followOut, `${JSON.stringify(f, null, 2)}\n`, 'utf8');
  }
  created.push(item.id);
}

const lines = [
  `计划拆分数 : ${PLAN.length}`,
  `新建       : ${created.length}`,
  ...created.map((c) => `    ${c}`),
  `manifest 元数据校正 : ${metaFixed.length}`,
  ...metaFixed.map((c) => `    ${c}`),
  `已存在跳过 : ${skippedExisting.length}`,
  ...skippedExisting.map((c) => `    ${c}`),
  `错误       : ${errors.length}`,
  ...errors.map((c) => `    ${c}`),
];
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'split-report.txt'), lines.join('\n'), 'utf8');
console.log(`created=${created.length} metaFixed=${metaFixed.length} skipped=${skippedExisting.length}`);
if (errors.length) process.exit(1);
