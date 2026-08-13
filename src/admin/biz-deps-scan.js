/**
 * Admin: scan skill/action business dependencies vs registered integrations & known tables.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TABLE_SCHEMAS } from '../services/table-data/schemas.js';
import { loadIntegrations } from './integrations.js';
import { loadActionResourceMap } from '../core/actions/fallback-prompt-builder.js';
import {
  KNOWN_INTEGRATION_ALIASES,
  SKILL_BIZ_DEPS,
} from './biz-deps-catalog.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../..');

/**
 * @returns {{
 *   ok: boolean,
 *   generated_at: string,
 *   skills: Array<object>,
 *   actions: Array<object>,
 *   summary: object,
 *   reports: Array<{level:string, module:string, message:string}>,
 * }}
 */
export function scanBizDependencies() {
  const integ = loadIntegrations();
  const integByKey = new Map(
    (integ.items || []).map((it) => [String(it.key || it.id || ''), it]),
  );
  const knownTables = new Set(Object.keys(TABLE_SCHEMAS || {}));
  const actionMap = safeLoadActionMap();

  const reports = [];
  const push = (level, module, message) => reports.push({ level, module, message });

  const skills = Object.entries(SKILL_BIZ_DEPS).map(([skill_key, dep]) => {
    const tables = (dep.tables || []).map((name) => ({
      name,
      declared: true,
      in_schema: knownTables.has(name),
    }));
    const missingTables = tables.filter((t) => !t.in_schema);
    const tagApis = (dep.tag_system || []).map((name) => ({
      name,
      declared: true,
    }));
    const integrations = (dep.integrations || []).map((key) => resolveIntegration(key, integByKey));

    const missingInteg = integrations.filter((i) => i.status === 'missing');
    const inactiveInteg = integrations.filter((i) => i.status === 'inactive');

    if (missingTables.length) {
      push('warn', `skill:${skill_key}`, `表未在 TABLE_SCHEMAS 登记：${missingTables.map((t) => t.name).join(', ')}`);
    }
    if (tagApis.length && !integrations.some((i) => i.key === 'tag_system' && i.status === 'active')) {
      const tag = resolveIntegration('tag_system', integByKey);
      if (tag.status !== 'active') {
        push('warn', `skill:${skill_key}`, `声明了 tag-system API，但 integrations.tag_system 状态=${tag.status}`);
      }
    }
    for (const i of missingInteg) {
      push('warn', `skill:${skill_key}`, `缺少第三方登记：${i.key}`);
    }
    for (const i of inactiveInteg) {
      push('ok', `skill:${skill_key}`, `第三方已登记未启用：${i.key}（可按需启用）`);
    }
    if (!missingTables.length && !missingInteg.length) {
      push('ok', `skill:${skill_key}`, `${dep.label} 依赖声明完整（表 ${tables.length} / tag ${tagApis.length} / 集成 ${integrations.length}）`);
    }

    return {
      skill_key,
      label: dep.label,
      notes: dep.notes || '',
      tables,
      tag_system: tagApis,
      integrations,
    };
  });

  const actions = (actionMap.actions || []).map((a) => {
    const skill_key = a.skill_key || '';
    const target = a.target || '';
    const integKey = mapActionTargetToIntegration(target);
    const integ = integKey ? resolveIntegration(integKey, integByKey) : null;
    if (integKey && integ?.status === 'missing') {
      push('warn', `action:${a.action_key}`, `target=${target} 未找到集成 ${integKey}`);
    }
    return {
      action_key: a.action_key,
      label: a.label,
      skill_key,
      target,
      endpoint: a.endpoint || '',
      next_template_id: a.next_template_id || '',
      integration: integ,
    };
  });

  const summary = {
    skill_count: skills.length,
    action_count: actions.length,
    table_schema_count: knownTables.size,
    integration_active: (integ.items || []).filter((i) => i.status === 'active').length,
    integration_total: (integ.items || []).length,
    warn: reports.filter((r) => r.level === 'warn').length,
    error: reports.filter((r) => r.level === 'error').length,
    ok: reports.filter((r) => r.level === 'ok').length,
  };

  return {
    ok: summary.error === 0,
    generated_at: new Date().toISOString(),
    catalog_path: 'src/admin/biz-deps-catalog.js',
    skills,
    actions,
    summary,
    reports,
  };
}

function safeLoadActionMap() {
  try {
    return loadActionResourceMap() || { actions: [] };
  } catch {
    try {
      const p = path.join(projectRoot, 'src/core/actions/action-resource-map.json');
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return { actions: [] };
    }
  }
}

function resolveIntegration(key, integByKey) {
  const aliases = KNOWN_INTEGRATION_ALIASES[key] || [key];
  for (const a of aliases) {
    const hit = integByKey.get(a);
    if (hit) {
      return {
        key,
        matched_key: a,
        name: hit.name || a,
        status: hit.status === 'active' ? 'active' : 'inactive',
        base_url: hit.base_url || '',
      };
    }
  }
  // soft keys not always in integrations.json (e.g. jintiaodong may be env-only)
  const envOnly = ['jintiaodong', 'yunzhen365'].includes(key);
  return {
    key,
    matched_key: null,
    name: key,
    status: envOnly ? 'env_or_code' : 'missing',
    base_url: '',
  };
}

function mapActionTargetToIntegration(target) {
  const t = String(target || '').toLowerCase();
  if (!t || t === 'flattalk' || t === 'knowledge') return null;
  if (t.includes('jtd') || t.includes('jintiaodong')) return 'jintiaodong';
  if (t.includes('tag')) return 'tag_system';
  if (t.includes('weather') && t.includes('q')) return 'qweather';
  if (t.includes('weather')) return 'tencent_weather';
  if (t.includes('map')) return 'tencent_map';
  if (t.includes('tavily') || t.includes('search')) return 'tavily';
  if (t.includes('ocr')) return 'ocr';
  if (t.includes('asr')) return 'volc_asr';
  return null;
}
