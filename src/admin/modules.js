// 其余 admin 模块处理器：模板工作台 / 资源校验 / 运行日志 / 对话运行 / 注册表 CRUD
import fs from 'node:fs';
import path from 'node:path';
import { json } from './util.js';
import { readReg, handleRegistryApi } from './store.js';
import { callModelChat } from './models.js';
import { discoverTemplates, renderTemplate, collectNames, collectTopLevelNames } from '../template-card/index.js';
import { makeTemplateFromHtml, parseMultipart, toTemplateId } from '../template-card/make-template.js';
import { loadIntegrations } from './integrations.js';
import { getTraceLogger } from '../core/observability/trace-logger.js';

const ROOT = process.cwd();
const REG_ALLOW = ['permissions', 'knowledge', 'config'];

// 模型注册表是 { models: [...] } 结构，需直读（readReg 会包成 { items }）
function readModels() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'model-registry.json'), 'utf8')).models || []; }
  catch { return []; }
}

// ---- 模板工作台 ----
// 递归扫描所有「.html + 同名 .manifest.json」对：仅技能目录(src/skills/<skill>/templates/html)
function scanTemplatePairs() {
  const SKILLS_DIR = path.join(ROOT, 'src', 'skills');
  const out = [];
  const walk = (dir, skill) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp, skill);
      else if (e.name.endsWith('.html')) {
        const man = fp.replace(/\.html$/, '.manifest.json');
        if (fs.existsSync(man)) out.push({ htmlFile: fp, manifestFile: man, skill });
      }
    }
  };
  if (fs.existsSync(SKILLS_DIR)) {
    for (const e of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('_')) walk(path.join(SKILLS_DIR, e.name, 'templates', 'html'), e.name);
    }
  }
  return out;
}

function listSkillKeys() {
  const SKILLS_DIR = path.join(ROOT, 'src', 'skills');
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name);
}

function parseEmbeddedJson(html) {
  const m = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch { return {}; }
}

function followupsDirForSkill(skill) {
  return path.join(ROOT, 'src', 'skills', skill, 'templates', 'followups');
}

function loadFollowups(skill, id) {
  const file = path.join(followupsDirForSkill(skill), `${id}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed?.followup_suggestions) ? parsed.followup_suggestions : [];
    return list.map((f) => ({ ...f, category: f.category === 'other' ? 'other' : 'tight' }));
  } catch { return []; }
}

function findTemplatePair(id) {
  return scanTemplatePairs().find((p) => {
    const m = JSON.parse(fs.readFileSync(p.manifestFile, 'utf8'));
    return (m.id || path.basename(p.htmlFile, '.html')) === id;
  });
}

// 将默认数据写回 HTML 内嵌的 <script type="application/json">，找不到则追加到 </body> 前
function setEmbeddedJson(html, obj) {
  const json = JSON.stringify(obj, null, 2);
  const re = /(<script[^>]*type=["']application\/json["'][^>]*>)([\s\S]*?)(<\/script>)/i;
  if (re.test(html)) return html.replace(re, `$1\n${json}\n$3`);
  return html.replace(/<\/body>/i, `<script type="application/json">\n${json}\n</script>\n</body>`);
}

async function handleTemplates(req, res, method, parts) {
  // 制作模板：上传 HTML（单文件 / 文件夹），生成模板卡写入指定技能目录
  if (parts[0] === 'make' && method === 'POST') {
    let parsed;
    try { parsed = await parseMultipart(req); }
    catch (e) { return json(res, 400, { ok: false, error: e.code || 'bad_request', message: e.message }); }
    const { fields, files } = parsed;
    const skill = (fields.skill || 'common').trim();
    const layout = fields.layout || 'card';
    const description = fields.description || '';
    const skillDir = path.join(ROOT, 'src', 'skills', skill);
    if (!fs.existsSync(skillDir)) return json(res, 400, { ok: false, error: 'unknown_skill', message: `技能目录不存在：${skill}` });
    const htmlDir = path.join(skillDir, 'templates', 'html');
    fs.mkdirSync(htmlDir, { recursive: true });
    const htmlFiles = files.filter((f) => f.filename && /\.html?$/i.test(f.filename));
    if (!htmlFiles.length) return json(res, 400, { ok: false, error: 'no_html_files', message: '未上传任何 HTML 文件' });
    const created = [];
    const skipped = [];
    const used = new Set();
    for (const file of htmlFiles) {
      const id = toTemplateId(file.filename);
      let finalId = id;
      let i = 2;
      while (used.has(finalId) || fs.existsSync(path.join(htmlDir, finalId + '.html'))) finalId = `${id}_${i++}`;
      used.add(finalId);
      const html = file.content.toString('utf8');
      if (!html.trim()) { skipped.push({ file: file.filename, reason: '内容为空' }); continue; }
      let result;
      try { result = makeTemplateFromHtml(html, { id: finalId, layout, description }); }
      catch (e) { skipped.push({ file: file.filename, reason: e.message }); continue; }
      fs.writeFileSync(path.join(htmlDir, finalId + '.html'), result.html, 'utf8');
      fs.writeFileSync(path.join(htmlDir, finalId + '.manifest.json'), JSON.stringify(result.manifest, null, 2), 'utf8');
      created.push({ id: finalId, path: path.relative(ROOT, path.join(htmlDir, finalId + '.html')) });
    }
    return json(res, 200, { ok: true, created, skipped, skill });
  }

  // 校验（含技能目录与公共库）；支持按 skill / id 范围筛选（目录级稽核）
  if (parts[0] === 'validate' && method === 'POST') {
    const b = await (await import('./util.js')).readJsonSafe(req, res);
    if (b === undefined) return;
    const filter = b || {};
    const reports = [];
    const pairs = scanTemplatePairs().filter((p) => {
      if (filter.id) {
        const m = JSON.parse(fs.readFileSync(p.manifestFile, 'utf8'));
        return (m.id || path.basename(p.htmlFile, '.html')) === filter.id;
      }
      if (filter.skill) return p.skill === filter.skill;
      return true;
    });
    for (const { htmlFile, manifestFile, skill } of pairs) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const id = manifest.id || path.basename(htmlFile, '.html');
      const html = fs.readFileSync(htmlFile, 'utf8');
      const names = collectTopLevelNames(html);
      const missing = names.filter((n) => !(n in (parseEmbeddedJson(html) || {})));
      if (missing.length) reports.push({ level: 'warn', module: 'template:' + id, message: `(${skill}) 字段未提供默认值：${missing.join(', ')}` });
      else reports.push({ level: 'ok', module: 'template:' + id, message: `(${skill}) 字段齐全（${names.length} 个）` });
    }
    return json(res, 200, { ok: true, reports });
  }

  // 预览
  if (parts[0] === 'preview' && parts[1] && method === 'GET') {
    const id = decodeURIComponent(parts[1]);
    const pair = scanTemplatePairs().find((p) => {
      const m = JSON.parse(fs.readFileSync(p.manifestFile, 'utf8'));
      return (m.id || path.basename(p.htmlFile, '.html')) === id;
    });
    if (!pair) return json(res, 404, { ok: false, error: 'template_not_found' });
    const html = fs.readFileSync(pair.htmlFile, 'utf8');
    const out = renderTemplate(html, parseEmbeddedJson(html) || {});
    const layout = JSON.parse(fs.readFileSync(pair.manifestFile, 'utf8')).layout || 'card';
    return json(res, 200, { ok: true, id, html: out, layout });
  }

  // 追问读写：/templates/:id/followups（admin 挂载的紧密/其他追问）
  if (parts[0] && parts[1] === 'followups') {
    const id = decodeURIComponent(parts[0]);
    const pair = findTemplatePair(id);
    if (!pair) return json(res, 404, { ok: false, error: 'template_not_found' });
    const skill = pair.skill;
    const file = path.join(followupsDirForSkill(skill), `${id}.json`);
    if (method === 'GET') {
      return json(res, 200, { ok: true, template_id: id, followup_suggestions: loadFollowups(skill, id) });
    }
    if (method === 'PUT') {
      const b = await (await import('./util.js')).readJsonSafe(req, res);
      if (b === undefined) return;
      if (!Array.isArray(b.followup_suggestions)) return json(res, 400, { ok: false, error: 'followup_suggestions_required' });
      const normalized = b.followup_suggestions
        .filter((f) => f && f.label && f.user_prompt)
        .map((f) => ({
          label: String(f.label),
          user_prompt: String(f.user_prompt),
          ...(f.action_key ? { action_key: String(f.action_key) } : {}),
          category: f.category === 'other' ? 'other' : 'tight',
          ...(f.intent ? { intent: String(f.intent) } : {}),
        }));
      fs.mkdirSync(followupsDirForSkill(skill), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ template_id: id, followup_suggestions: normalized }, null, 2), 'utf8');
      return json(res, 200, { ok: true, template_id: id, followup_suggestions: normalized });
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  // 模板源码读写：/templates/:id/source（HTML 源码 + manifest + 内嵌默认数据）
  if (parts[0] && parts[1] === 'source') {
    const id = decodeURIComponent(parts[0]);
    const pair = findTemplatePair(id);
    if (!pair) return json(res, 404, { ok: false, error: 'template_not_found' });
    if (method === 'GET') {
      const html = fs.readFileSync(pair.htmlFile, 'utf8');
      const manifest = fs.readFileSync(pair.manifestFile, 'utf8');
      return json(res, 200, { ok: true, template_id: id, html, manifest, defaultData: parseEmbeddedJson(html) });
    }
    if (method === 'PUT') {
      const b = await (await import('./util.js')).readJsonSafe(req, res);
      if (b === undefined) return;
      if (typeof b.manifest !== 'string') return json(res, 400, { ok: false, error: 'manifest_required' });
      try {
        const parsedManifest = JSON.parse(b.manifest);
        parsedManifest.id = id;
        fs.writeFileSync(pair.manifestFile, JSON.stringify(parsedManifest, null, 2), 'utf8');
      } catch { return json(res, 400, { ok: false, error: 'invalid_manifest_json' }); }
      let html = typeof b.html === 'string' ? b.html : fs.readFileSync(pair.htmlFile, 'utf8');
      if (b.defaultData !== undefined) {
        try { html = setEmbeddedJson(html, typeof b.defaultData === 'string' ? JSON.parse(b.defaultData) : b.defaultData); }
        catch { return json(res, 400, { ok: false, error: 'invalid_defaultdata_json' }); }
      }
      fs.writeFileSync(pair.htmlFile, html, 'utf8');
      return json(res, 200, { ok: true, template_id: id, saved: true });
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  // 列表（技能目录），并携带技能列与可选技能清单
  const items = scanTemplatePairs().map(({ htmlFile, manifestFile, skill }) => {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const id = manifest.id || path.basename(htmlFile, '.html');
    const html = fs.readFileSync(htmlFile, 'utf8');
    const defaultData = parseEmbeddedJson(html);
    const names = collectTopLevelNames(html);
    const missing = names.filter((n) => !(n in (defaultData || {})));
    return {
      id,
      skill,
      layout: manifest.layout || 'card',
      description: manifest.match || manifest.description || '',
      fields: names.length,
      hasDefault: missing.length === 0,
      dir: path.relative(ROOT, htmlFile),
      followups: loadFollowups(skill, id),
    };
  });
  return json(res, 200, { ok: true, items, skills: listSkillKeys(), dir: 'aggregated' });
}

// ---- 资源校验 ----
async function handleValidate(req, res) {
  let filter = {};
  if (req.method === 'POST') {
    const b = await (await import('./util.js')).readJsonSafe(req, res);
    if (b === undefined) return; // 400 已返回
    filter = b || {};
  }
  const reports = [];
  const push = (level, module, message) => reports.push({ level, module, message });

  // 模型注册表（全局环境检查：仅在全量稽核时执行）
  if (!filter.id && !filter.skill) {
    const models = readModels();
    const defaults = models.filter((m) => m.is_default);
    if (defaults.length === 0) push('warn', 'model-registry', '未设置默认模型');
    else if (defaults.length > 1) push('error', 'model-registry', `存在 ${defaults.length} 个默认模型，应仅 1 个`);
    else push('ok', 'model-registry', `默认模型：${defaults[0].name}`);
    const inactive = models.filter((m) => !m.is_active);
    if (inactive.length) push('warn', 'model-registry', `${inactive.length} 个模型处于停用`);
  }

  // 模板（聚合：技能目录 + 公共库）
  try {
    const pairs = scanTemplatePairs().filter((p) => {
      if (filter.id) {
        const m = JSON.parse(fs.readFileSync(p.manifestFile, 'utf8'));
        return (m.id || path.basename(p.htmlFile, '.html')) === filter.id;
      }
      if (filter.skill) return p.skill === filter.skill;
      return true;
    });
    for (const { htmlFile, manifestFile, skill } of pairs) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const id = manifest.id || path.basename(htmlFile, '.html');
      const names = collectTopLevelNames(fs.readFileSync(htmlFile, 'utf8'));
      const missing = names.filter((n) => !(n in (parseEmbeddedJson(fs.readFileSync(htmlFile, 'utf8')) || {})));
      if (missing.length) push('warn', 'template:' + id, `(${skill}) 缺省字段：${missing.join(', ')}`);
    }
    push('ok', 'templates', `模板总数 ${pairs.length}`);
  } catch (e) { push('error', 'templates', e.message); }

  // 权限矩阵（全局环境检查：仅在全量稽核时执行）
  if (!filter.id && !filter.skill) {
    let permRoles = [];
    try { permRoles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'permissions.json'), 'utf8')).roles || []; } catch { /* ignore */ }
    if (!permRoles.length) push('warn', 'permissions', '权限矩阵未配置角色');
    else push('ok', 'permissions', `角色数 ${permRoles.length}`);
  }

  // 第三方API（含原「外部服务」登记，已合并；全局环境检查：仅在全量稽核时执行）
  if (!filter.id && !filter.skill) {
    try {
      const integ = loadIntegrations();
      const active = integ.items.filter((i) => i.status === 'active').length;
      if (!integ.items.length) push('warn', 'integrations', '未登记第三方API');
      else push('ok', 'integrations', `第三方API ${integ.items.length} 个（启用 ${active}）`);
    } catch (e) { push('error', 'integrations', e.message); }
  }

  const levelRank = { error: 0, warn: 1, ok: 2 };
  reports.sort((a, b) => levelRank[a.level] - levelRank[b.level]);
  return json(res, 200, { ok: true, reports });
}

// ---- 运行日志 ----
function handleLogs(req, res, parts) {
  const f = path.join(ROOT, 'data', 'runtime.log');
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  if (parts[0] === 'clear') {
    try { if (fs.existsSync(f)) fs.writeFileSync(f, ''); } catch {}
    try { getTraceLogger().clear(); } catch {}
    return json(res, 200, { ok: true, cleared: true });
  }
  const raw = lines.slice(-200).reverse().map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  const traces = getTraceLogger().list({ limit: 300 });
  return json(res, 200, { ok: true, lines: raw, total: lines.length, traces, total_traces: traces.length });
}

// ---- 对话运行 ----
async function handleDialogue(req, res) {
  const b = await (await import('./util.js')).readJsonSafe(req, res);
  if (b === undefined) return;
  if (!b.message) return json(res, 400, { ok: false, error: 'message_required' });
  const models = readModels();
  const model = (b.modelId && models.find((m) => m.id === Number(b.modelId)))
    || models.find((m) => m.is_default && m.is_active)
    || models.find((m) => m.is_active);
  if (!model) return json(res, 400, { ok: false, error: 'no_available_model' });
  const r = await callModelChat(model, b.message, { max_tokens: 512, temperature: 0.7 });
  return json(res, 200, { ok: true, model: model.name, ...r });
}

// ---- 权限矩阵：角色 × 技能 矩阵（权限矩阵）----
function scanSkills() {
  const SKILLS_DIR = path.join(ROOT, 'src', 'skills');
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name);
}
function defaultRoleSkillMatrix() {
  const skills = scanSkills();
  const keep = (arr) => arr.filter((s) => skills.includes(s));
  const defs = [
    // 长者
    { key: 'elder', cn_name: '老人', skills: keep(['common', 'meal_plan', 'travel_route']) },
    { key: 'elder_family', cn_name: '家属', skills: keep(['common', 'meal_plan', 'travel_route']) },
    // 医护
    { key: 'village_doctor', cn_name: '村医', skills: keep(['common', 'health_risk_warning', 'dispatch_manage']) },
    { key: 'community_doctor', cn_name: '社区居家-医生', skills: keep(['common', 'health_risk_warning', 'dispatch_manage']) },
    // 护理
    { key: 'care_worker', cn_name: '护理员', skills: keep(['common', 'meal_plan', 'health_risk_warning', 'dispatch_manage']) },
    { key: 'community_helper', cn_name: '社区居家-助老员', skills: keep(['common', 'find_service']) },
    // 机构管理
    { key: 'institution_admin', cn_name: '机构端-管理员', skills: keep(['common', 'meal_plan', 'find_service', 'dispatch_manage']) },
    // 服务方
    { key: 'provider_staff', cn_name: '服务商', skills: keep(['common', 'find_service']) },
    { key: 'community_support', cn_name: '社区居家-后勤', skills: keep(['common']) },
    { key: 'community_canteen', cn_name: '社区居家-食堂', skills: keep(['common', 'meal_plan']) },
    { key: 'community_kitchen', cn_name: '社区居家-厨房', skills: keep(['common', 'meal_plan']) },
    { key: 'community_guard', cn_name: '社区居家-门卫', skills: keep(['common']) },
    { key: 'community_maintenance', cn_name: '社区居家-维修', skills: keep(['common']) },
    // 政府/管理
    { key: 'senior_official', cn_name: '厅级干部', skills: keep(['common']), wildcard: true },
    { key: 'system_admin', cn_name: '超级管理员', skills: [], wildcard: true },
    { key: 'admin', cn_name: '配置管理员', skills: [], wildcard: true },
    { key: 'civil_affairs_staff', cn_name: '民政局科员', skills: keep(['common', 'elder_policy', 'find_service']) },
    { key: 'grid_worker', cn_name: '社区网格员', skills: keep(['common', 'find_service', 'dispatch_manage']) },
  ];
  return defs.map((d) => ({ key: d.key, cn_name: d.cn_name, wildcard: Boolean(d.wildcard), skills: d.skills || [] }));
}
function normalizeRoles(roles, skills) {
  return (roles || []).map((r) => ({
    key: r.key,
    cn_name: r.cn_name || r.key,
    wildcard: Boolean(r.wildcard),
    skills: skills.filter((s) => (r.skills || []).includes(s)),
  }));
}
async function handlePermissions(req, res, method, parts) {
  const f = path.join(ROOT, 'data', 'permissions.json');
  const load = () => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { roles: [] });
  const skills = scanSkills();
  const sub = parts[1];

  // 从代码同步默认矩阵
  if (sub === 'sync' && method === 'POST') {
    const roles = defaultRoleSkillMatrix();
    fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
    return json(res, 200, { ok: true, roles, skills });
  }

  // 角色管理：/api/admin/permissions/roles[/:key]
  if (sub === 'roles') {
    const roles = load().roles || [];
    if (method === 'POST') {
      const b = await (await import('./util.js')).readJsonSafe(req, res);
      if (b === undefined) return;
      if (!b.key) return json(res, 400, { ok: false, error: 'key_required' });
      if (roles.some((r) => r.key === b.key)) return json(res, 409, { ok: false, error: 'role_exists' });
      const role = { key: b.key, cn_name: b.cn_name || b.key, wildcard: Boolean(b.wildcard), skills: Array.isArray(b.skills) ? b.skills.filter((s) => skills.includes(s)) : [] };
      roles.push(role);
      fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
      return json(res, 200, { ok: true, role });
    }
    const key = parts[2];
    if (key) {
      const role = roles.find((r) => r.key === key);
      if (!role) return json(res, 404, { ok: false, error: 'role_not_found' });
      if (method === 'PUT') {
        const b = await (await import('./util.js')).readJsonSafe(req, res);
        if (b === undefined) return;
        if (b.cn_name !== undefined) role.cn_name = b.cn_name;
        if (b.wildcard !== undefined) role.wildcard = Boolean(b.wildcard);
        if (Array.isArray(b.skills)) role.skills = b.skills.filter((s) => skills.includes(s));
        fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
        return json(res, 200, { ok: true, role });
      }
      if (method === 'DELETE') {
        const idx = roles.findIndex((r) => r.key === key);
        roles.splice(idx, 1);
        fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
        return json(res, 200, { ok: true });
      }
    }
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  // 矩阵读写（角色 + 技能清单）
  if (method === 'GET') {
    let obj = load();
    const legacy = (obj.roles || []).some((r) => !('key' in r) || !('skills' in r));
    if (!obj.roles || !obj.roles.length || legacy) {
      obj = { roles: defaultRoleSkillMatrix() };
      fs.writeFileSync(f, JSON.stringify(obj, null, 2));
    }
    return json(res, 200, { ok: true, roles: obj.roles, skills });
  }
  if (method === 'PUT') {
    const b = await (await import('./util.js')).readJsonSafe(req, res);
    if (b === undefined) return;
    if (!Array.isArray(b.roles)) return json(res, 400, { ok: false, error: 'roles_required' });
    const roles = normalizeRoles(b.roles, skills);
    fs.writeFileSync(f, JSON.stringify({ roles }, null, 2));
    return json(res, 200, { ok: true, roles });
  }
  return json(res, 405, { ok: false, error: 'method_not_allowed' });
}

// 分发
export async function handleModuleApi(req, res, method, parts) {
  const name = parts[0];
  if (name === 'templates') return handleTemplates(req, res, method, parts.slice(1));
  if (name === 'validate' && method === 'GET') return handleValidate(req, res);
  if (name === 'logs') return handleLogs(req, res, parts.slice(1));
  if (name === 'dialogue' && method === 'POST') return handleDialogue(req, res);
  if (name === 'permissions') return handlePermissions(req, res, method, parts);
  if (name === 'registries') {
    const r = await handleRegistryApi(req, res, method, parts.slice(2), parts[1], REG_ALLOW);
    if (r) return json(res, r.status, r.body);
    return; // readJsonSafe 已写 400
  }
  return json(res, 404, { ok: false, error: 'module_not_found', name });
}
