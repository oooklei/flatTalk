// 三层选型：① 模型指定的 template_id → ② 字段覆盖率兜底 → ③ 通用默认模板
import { collectNames } from './render.js';

// 收集数据里出现的所有字段名（顶层 + 首个数组元素），用于覆盖率打分
function collectDataKeys(data) {
  const keys = new Set();
  const walk = (v, prefix = '') => {
    if (v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) { if (v[0] && typeof v[0] === 'object') walk(v[0], prefix); return; }
    for (const k of Object.keys(v)) {
      keys.add(k);
      keys.add(prefix + k);
      walk(v[k], prefix + k + '.');
    }
  };
  walk(data);
  return keys;
}

// 计算某个模板对数据的匹配度（覆盖率）
function scoreTemplate(tpl, dataKeys) {
  const names = collectNames(tpl.body);
  if (!names.length) return { score: 0, hits: 0, total: 0 };
  const required = tpl.required.length ? tpl.required : names.map((n) => n.split('.')[0]);
  let hits = 0;
  for (const r of required) {
    const first = r.split('.')[0];
    if (dataKeys.has(r) || dataKeys.has(first)) hits++;
  }
  return { score: hits / required.length, hits, total: required.length };
}

export function selectTemplate(templates, { templateId, data }) {
  if (!templates.length) throw new Error('模板库为空');

  // 第 1 层：模型直接指定 id
  if (templateId) {
    const hit = templates.find((t) => t.id === templateId);
    if (hit) return { template: hit, reason: 'model-id', score: 1 };
  }

  // 第 2 层：字段覆盖率兜底
  const dataKeys = collectDataKeys(data);
  const ranked = templates
    .map((t) => ({ t, ...scoreTemplate(t, dataKeys) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.hits - a.hits);

  if (ranked.length && ranked[0].score >= 0.5) {
    return { template: ranked[0].t, reason: 'field-coverage', score: ranked[0].score };
  }

  // 第 3 层：通用默认模板（优先名为 default/markdown 的，否则变量最少的）
  const fallback = templates.find((t) => /^(default|markdown|generic)$/i.test(t.id)) ||
    [...templates].sort((a, b) => collectNames(a.body).length - collectNames(b.body).length)[0];
  return { template: fallback, reason: ranked.length ? 'low-coverage-fallback' : 'no-match-fallback', score: ranked[0]?.score || 0 };
}
