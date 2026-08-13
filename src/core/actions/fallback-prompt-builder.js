import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelForActionKey } from './action-labels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 按钮动作通用兜底的资源清单加载与查表。
 * 资源清单复用 action-registry 结构，补充 endpoint / param_sources 两项。
 */

export const ACTION_RESOURCE_MAP_PATH = path.join(__dirname, 'action-resource-map.json');

/** 特例白名单：这些 action 在 orchestrator 走硬编码/本地填槽分支，不走通用 LLM 兜底。 */
export const SPECIAL_CASE_ACTION_KEYS = [
  'travel_route.check_weather_risk',
  'travel_route.check_availability',
  'travel_route.calculate_budget',
  'travel_route.booking_handoff',
];

/** 加载资源清单（action-resource-map.json）。 */
export function loadActionResourceMap(customPath) {
  const mapPath = customPath || ACTION_RESOURCE_MAP_PATH;
  const raw = fs.readFileSync(mapPath, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed;
}

/** 查表：返回某 action_key 的资源条目；查不到返回 null。缺省用内置清单。 */
export function getActionResource(actionKey, resourceMap) {
  const map = resourceMap || loadActionResourceMap();
  if (!actionKey || !map || !Array.isArray(map.actions)) return null;
  return map.actions.find((a) => a.action_key === actionKey) || null;
}

/**
 * 从 businessData / request 抽取兜底所需上下文摘要。
 * 兼容 travel_route（jtd.selected_product）/ meal_plan（condition）等结构。
 */
export function buildFallbackContext(businessData = {}, request = {}) {
  const product = businessData?.jtd?.selected_product || businessData?.route || {};
  const ctx = {
    destination: businessData?.destination || product?.destination || '',
    days: businessData?.days ?? product?.days ?? '',
    headcount: businessData?.headcount ?? product?.headcount ?? '',
    region: businessData?.region || product?.region || '',
    condition: businessData?.condition || product?.condition || '',
    elder_type: businessData?.elderType || businessData?.elder_type || product?.elder_type || '',
    text: request?.message || request?.text || '',
  };
  return ctx;
}

function summarizeContext(context = {}) {
  const parts = [];
  if (context.destination) parts.push(`目的地：${context.destination}`);
  if (context.days) parts.push(`天数：${context.days}`);
  if (context.headcount) parts.push(`人数：${context.headcount}`);
  if (context.region) parts.push(`地区：${context.region}`);
  if (context.condition) parts.push(`慢病类型：${context.condition}`);
  if (context.elder_type) parts.push(`老人类别：${context.elder_type}`);
  if (context.text) parts.push(`用户原话：${context.text}`);
  return parts.length ? parts.join('；') : '（上下文暂无明确信息，缺失项请向用户追问，不要臆造）';
}

function listParams(paramsSchema = {}, paramSources = {}) {
  const entries = Object.entries(paramsSchema);
  if (!entries.length) return '（该动作无需显式参数）';
  const lines = entries.map(([name, meaning], idx) => {
    const src = paramSources?.[name] || '（由上下文或追问确定）';
    return `- 第${idx + 1}个参数：${name}（${meaning}）；取值：${src}`;
  });
  return lines.join('\n');
}

/**
 * 生成按钮动作通用兜底的「五要素」结构化提示词。
 *  @param {object} action 资源清单条目（含 label/target/description/endpoint/params_schema/param_sources/next_template_id）
 * @param {object} context 上下文摘要（buildFallbackContext 产出或等价对象）
 * @param {object[]} skillResources 同 skill_key 的资源条目集合（用于【有什么资源】）
 * @param {object} [extra] 可选扩展：{ evidence: string }
 */
export function buildFallbackActionPrompt(action = {}, context = {}, skillResources = [], extra = {}) {
  const label = labelForActionKey(action.action_key, action.label || '未知按钮');
  const description = action.description || '';
  const target = action.target || 'flattalk';
  const endpoint = action.endpoint || '（无明确接口地址）';
  const paramsSchema = action.params_schema || {};
  const paramSources = action.param_sources || {};
  const paramCount = Object.keys(paramsSchema).length;
  const nextTemplateId = action.next_template_id || 'answer';

  const skillList = (Array.isArray(skillResources) ? skillResources : [])
    .map((r) => `- ${labelForActionKey(r.action_key, r.label || '未知按钮')}（${r.target}）：${r.endpoint || ''}`)
    .join('\n');

  const evidenceText = extra?.evidence
    ? `\n\n【已注入知识库证据】\n${extra.evidence}`
    : '';

  const skillInstruction = buildActionSkillInstruction(action.action_key);

  return [
    '你是养老助手「桂小养」大模型，负责执行用户点击的按钮动作，并合成面向老人家属的答复。',
    '',
    `【谁】你（桂小养大模型）。`,
    `【做什么】按钮标签：${label}；动作说明：${description}`,
    `【怎么做】`,
    `- 执行时间：立刻（用户点击即触发）。`,
    `- 使用资源类型：${target}。`,
    `- 接口地址：${endpoint}。`,
    `- 参数个数：${paramCount} 个。`,
    listParams(paramsSchema, paramSources),
    `- 参数取值原则：优先从上下文已有信息抽取，缺失时向用户追问，不要臆造。`,
    `【有什么资源】本技能可用资源清单：`,
    skillList || '（暂无登记的其他资源）',
    `【每个动作的资源】本动作专用：资源类型=${target}；接口地址=${endpoint}；所需参数见上方【怎么做】。`,
    '',
    `【上下文摘要】${summarizeContext(context)}`,
    '',
    skillInstruction,
    '',
    '请基于以上资源与上下文执行该动作：',
    '- 若【有什么资源】含「知识库」类（target=knowledge），已为你注入相关证据（evidence），请基于证据推理作答；',
    '- 若含业务接口类资源（target=jintiaodong/HTTP/flattalk），请依据接口地址与参数说明，结合上下文给出可执行方案与要点；',
    `最终以结构化 JSON 返回，匹配模板 ${nextTemplateId} 的字段结构（含 title、summary、要点列表、风险提示、后续建议）。`,
    evidenceText,
  ].join('\n');
}

/**
 * 按钮动作专属指令：travel_route 技能强制「金跳动产品优先」，
 * 与主规划链路（template-card-llm-service.buildSkillInstruction）保持一致。
 */
export function buildActionSkillInstruction(actionKey = '') {
  if (typeof actionKey === 'string' && actionKey.startsWith('travel_route.')) {
    return [
      '【旅居路线规划 · 金跳动优先规则（按钮动作同样适用）】',
      '1. 本动作涉及的旅居路线产品以 business_data 中的 jtd.products（金跳动接口可售产品）为【首要对象】，答复与要点须以金跳动产品为准。',
      '2. 本地路线（防城港线路、十条精品路线等）仅作【补充参考】；仅当 jtd.products 为空或不可订时改用本地路线，并标注来源。',
      '3. 严禁把本地路线排在金跳动产品之前作为首推或主结论。',
    ].join('\n');
  }
  return '（本动作无专属指令）';
}
