// 两阶段 LLM 选模板 + 字段强约束 的提示词 / schema 生成工具。
// 阶段一：buildSelectPrompt —— 把模板库（含语义描述 match）拼成“选模板”提示词，
//         让模型只返回最合适的 template_id（语义选择，非文件名匹配）。
// 阶段二：jsonSchemaFor —— 由模板 {{占位符}} 自动反推 JSON Schema，
//         用作 function-calling / 结构化输出的约束，强制模型输出的 key 与模板对齐。

import { collectNames } from './render.js';

// 阶段一：生成“选模板”提示词。模型读 match（语义）挑 id，文件名不参与判断。
export function buildSelectPrompt(templates, userQuestion) {
  const list = templates
    .map((t) => `- ${t.id}：${t.match || t.description || '通用卡片'}`)
    .join('\n');
  return [
    '你是一个卡片模板选择器。根据用户问题，从下面的可选模板中选出最合适的一个。',
    '只输出你选中的模板 id（纯文本，不要解释、不要引号、不要 JSON）。',
    '',
    '【可选模板】',
    list,
    '',
    `【用户问题】${userQuestion}`,
  ].join('\n');
}

// 递归解析模板 body 的区间（section）结构，支持任意层嵌套。
// 返回 { scalars:Set, sections:[{name, scalars:Set, sections:[...]}] }
// 例：meals 区间内含 foods 区间 → meals 的 sections 里会有 foods。
function buildSchema(body) {
  const sectionRe = /\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  const sections = [];
  const spans = []; // 顶层区间的文本跨度，用于排除其中的变量（避免误归到本层标量）
  let m;
  while ((m = sectionRe.exec(body))) {
    const name = m[1];
    const inner = m[2];
    spans.push([m.index, m.index + m[0].length]);
    sections.push({ name, ...buildSchema(inner) }); // 递归解析子层
  }

  const scalars = new Set();
  for (const v of body.matchAll(/\{\{\{\s*([\w.|]+)\s*\}\}\}|\{\{\s*([\w.|]+)\s*\}\}/g)) {
    const start = v.index;
    if (spans.some(([s, e]) => start >= s && start < e)) continue; // 在区间内 → 已交由子层处理
    const vn = (v[1] || v[2]).split('|')[0]; // 去掉 {{var|default}} 的兜底后缀
    if (!vn || '#/^&'.includes(vn[0]) || vn.includes('.') || vn === '.') continue;
    if (sections.some((s) => s.name === vn)) continue; // 是区间名而非变量
    scalars.add(vn);
  }
  return { scalars, sections };
}

// 把递归结构转成 JSON Schema 的 properties（区间 → array of objects，可无限嵌套）
function schemaToProperties(node) {
  const properties = {};
  for (const s of node.scalars) properties[s] = { type: 'string' };
  for (const sec of node.sections) {
    properties[sec.name] = {
      type: 'array',
      items: { type: 'object', properties: schemaToProperties(sec) },
    };
  }
  return properties;
}

// 阶段二：由模板反推 JSON Schema（供结构化输出 / function-calling 强约束）。
// 区间字段 → array of objects（可嵌套）；标量字段 → string。required 取自 manifest.required。
export function jsonSchemaFor(template) {
  const tree = buildSchema(template.body || '');
  const properties = schemaToProperties(tree);

  // 兜底：若解析为空（模板无占位符），退回 collectNames 平面处理
  if (Object.keys(properties).length === 0) {
    for (const k of collectNames(template.body || '')) properties[k] = { type: 'string' };
  }

  return {
    type: 'object',
    properties,
    required: template.required || [],
  };
}

// 把 schema 渲染成“阶段二填字段”的纯文本提示词（无需工具调用时的降级方案）。
export function buildFillPrompt(userQuestion, template, schema) {
  const fieldLines = Object.entries(schema.properties).map(([k, v]) => {
    if (v.type === 'array') return `- ${k}：数组，每项含 ${Object.keys(v.items.properties).join('、')}`;
    return `- ${k}：文本`;
  });
  const req = schema.required.length ? `\n【必填字段】${schema.required.join('、')}` : '';
  return [
    '根据下面的用户问题和已选定的模板，严格填充该模板所需的字段。',
    '你必须且只能输出这些字段，字段名严格一致，不要新增或改名。',
    '',
    `【已选模板】${template.id}`,
    `【字段说明】`,
    ...fieldLines,
    req,
    '',
    `【用户问题】${userQuestion}`,
    '',
    '请按 JSON Schema 返回数据：',
    JSON.stringify(schema, null, 2),
  ].join('\n');
}
