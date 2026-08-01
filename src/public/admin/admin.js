const API = '/api/admin';
const TITLES = {
  models: '模型治理', templates: '模板工作台', validate: '资源校验', logs: '运行日志',
  knowledge: '知识导入', dialogue: '对话运行',
  integrations: '第三方API', openapi: 'Open API', authaccess: '认证接入', embeds: '第三方嵌入',
  permissions: '权限矩阵', config: '系统配置',
};

const nav = document.getElementById('nav');
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const topbarActions = document.getElementById('topbar-actions');
const modalRoot = document.getElementById('modal-root');

nav.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  showModule(btn.dataset.mod);
});

async function api(path, opts) {
  const r = await fetch(API + path, opts);
  return r.json();
}
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n[k.toLowerCase()] = v;
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}
function btn(label, onclick, cls = 'btn primary') { return el('button', { class: cls, onclick }, label); }
function badge(cls, text) { return `<span class="badge ${cls}">${text}</span>`; }
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
function esc(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function fmtBJ(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return String(input || '');
  const bj = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${bj.getFullYear()}-${p(bj.getMonth() + 1)}-${p(bj.getDate())} ${p(bj.getHours())}:${p(bj.getMinutes())}:${p(bj.getSeconds())}`;
}
function openModal(node) { modalRoot.innerHTML = ''; modalRoot.append(el('div', { class: 'modal-backdrop' }, node)); }
function closeModal() { modalRoot.innerHTML = ''; }

function openFormModal(fields, values, onSubmit, title) {
  const f = el('form', { class: 'modal-card' });
  f.innerHTML = `<h3>${title}</h3>` + fields.map((fld) => {
    const v = values?.[fld.name] ?? '';
    if (fld.checkbox) return `<label class="check"><input type="checkbox" name="${fld.name}" ${v ? 'checked' : ''}> ${fld.label}</label>`;
    const ro = fld.readonly ? 'readonly' : '';
    return `<label>${fld.label} <input name="${fld.name}" value="${escAttr(v)}" ${ro}></label>`;
  }).join('') + `<div class="modal-actions"><button type="button" class="btn" id="cancel">取消</button><button type="submit" class="btn primary">保存</button></div>`;
  openModal(f);
  f.querySelector('#cancel').onclick = closeModal;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f).entries());
    for (const fld of fields) {
      if (fld.checkbox) fd[fld.name] = f.querySelector(`input[name="${fld.name}"]`).checked;
      if (fld.number) fd[fld.name] = Number(fd[fld.name]);
    }
    await onSubmit(fd);
    closeModal();
  };
}

async function showModule(mod) {
  titleEl.textContent = TITLES[mod] || mod;
  topbarActions.innerHTML = '';
  view.innerHTML = '';
  const map = {
    models: renderModels, templates: renderTemplates, validate: renderValidate,
    logs: renderLogs, knowledge: () => renderCrud(CRUD.knowledge), dialogue: renderDialogue,
    integrations: renderIntegrations, openapi: renderOpenApi,
    authaccess: renderAuthAccess, embeds: renderEmbeds,
    permissions: renderPermissions, config: () => renderCrud(CRUD.config),
  };
  (map[mod] || (() => { view.innerHTML = `<div class="placeholder">模块「${TITLES[mod]}」待开发</div>`; }))();
}

/* ============ 模型治理 ============ */
const PROVIDER_LABEL = {
  zhipu: '智谱 AI', mock: '本地模拟', openai: 'OpenAI', anthropic: 'Anthropic',
  dashscope: '阿里通义', deepseek: 'DeepSeek', qwen: '通义千问', azure: 'Azure',
  moonshot: '月之暗面', doubao: '豆包', gemini: 'Google',
};
const TYPE_LABEL = {
  llm_text: '文本大模型', llm_vision: '多模态', embedding: '向量模型',
  rerank: '重排模型', tts: '语音合成', stt: '语音识别',
};
async function renderModels() {
  const { items } = await api('/models');
  topbarActions.append(btn('＋ 新建模型', () => openForm(null)));
  const rows = items.map((m) => el('tr', {},
    el('td', {}, String(m.id)),
    el('td', {}, m.name),
    el('td', {}, m.display_name || '-'),
    el('td', {}, PROVIDER_LABEL[m.provider] || m.provider || '-'),
    el('td', {}, m.model_id || '-'),
    el('td', m.is_default ? { html: badge('ok', '默认') } : {}),
    el('td', { html: m.is_active ? badge('ok', '启用') : badge('warn', '停用') }),
    el('td', {}, m.owner || '-'),
    el('td', { html: m.has_api_key ? badge('ok', '有密钥') : badge('muted', '无密钥') }),
    el('td', { class: 'ops' }, ...opsFor(m)),
  ));
  view.append(el('table', { class: 'grid' },
    el('thead', {}, el('tr', {}, ...['ID', '名称', '显示名', '供应商', '模型ID', '默认', '状态', '属主', '密钥', '操作'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...rows),
  ));
}
function opsFor(m) {
  const test = el('button', { class: 'btn sm' }, '测试');
  test.onclick = async () => {
    test.textContent = '测试中…'; test.disabled = true;
    const r = await api(`/models/${m.id}/test`, { method: 'POST' });
    alert(`[${r.status || '-'}] ${r.message || ''}${r.reply ? '\n回复: ' + r.reply : ''}`);
    test.textContent = '测试'; test.disabled = false;
  };
  const def = el('button', { class: 'btn sm' }, '设默认');
  def.onclick = async () => { await api(`/models/${m.id}/set-default`, { method: 'POST' }); renderModels(); };
  const tog = el('button', { class: 'btn sm' }, m.is_active ? '停用' : '启用');
  tog.onclick = async () => { await api(`/models/${m.id}/${m.is_active ? 'disable' : 'enable'}`, { method: 'POST' }); renderModels(); };
  const edit = el('button', { class: 'btn sm' }, '编辑');
  edit.onclick = () => openForm(m);
  const del = el('button', { class: 'btn sm danger' }, '删除');
  del.onclick = async () => { if (confirm(`删除模型 ${m.name} ?`)) { await api(`/models/${m.id}`, { method: 'DELETE' }); renderModels(); } };
  return [test, def, tog, edit, del];
}
function openForm(m) {
  const isEdit = !!m;
  const f = el('form', { class: 'modal-card' });
  f.innerHTML = `
    <h3>${isEdit ? '编辑模型' : '新建模型'}</h3>
    <label>名称（唯一）* <input name="name" value="${escAttr(m?.name)}" ${isEdit ? 'readonly' : ''}></label>
    <label>显示名 <input name="display_name" value="${escAttr(m?.display_name)}"></label>
    <label>供应商 <input name="provider" value="${escAttr(m?.provider)}"></label>
    <label>API 地址 <input name="api_base" value="${escAttr(m?.api_base)}"></label>
    <label>模型标识 <input name="model_id" value="${escAttr(m?.model_id)}"></label>
    <label>类型 <input name="model_type" value="${escAttr(m?.model_type || 'llm_text')}"></label>
    <label>用途 <input name="purpose" value="${escAttr(m?.purpose)}"></label>
    <label>属主 <input name="owner" value="${escAttr(m?.owner || 'system')}"></label>
    <label>最大上下文令牌数 <input name="max_tokens" type="number" value="${m?.max_tokens ?? 4096}"></label>
    <label>温度（0-1） <input name="temperature" type="number" step="0.1" value="${m?.temperature ?? 0.7}"></label>
    <label>排序权重 <input name="sort_order" type="number" value="${m?.sort_order ?? 0}"></label>
    <label>API 密钥 ${isEdit ? '（留空表示不改）' : ''} <input name="api_key" type="password" placeholder="服务端保存，不回显"></label>
    <label class="check"><input type="checkbox" name="is_active" ${m?.is_active !== false ? 'checked' : ''}> 启用</label>
    <label class="check"><input type="checkbox" name="is_default" ${m?.is_default ? 'checked' : ''}> 设为默认</label>
    <div class="modal-actions">
      <button type="button" class="btn" id="cancel">取消</button>
      <button type="submit" class="btn primary">保存</button>
    </div>`;
  openModal(f);
  f.querySelector('#cancel').onclick = closeModal;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f).entries());
    fd.max_tokens = Number(fd.max_tokens);
    fd.temperature = Number(fd.temperature);
    fd.sort_order = Number(fd.sort_order);
    fd.is_active = f.querySelector('input[name=is_active]').checked;
    fd.is_default = f.querySelector('input[name=is_default]').checked;
    if (isEdit) await api(`/models/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    else await api(`/models`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    closeModal();
    renderModels();
  };
}

/* ============ 模板工作台 ============ */
function skillBadge(skill) {
  const label = skill;
  const cls = skill === 'library' ? 'muted' : 'info';
  return `<span class="badge ${cls}">${label}</span>`;
}
async function renderTemplates() {
  const { items, skills = [] } = await api('/templates');
  const bySkill = {};
  for (const it of (items || [])) (bySkill[it.skill] ||= []).push(it);

  topbarActions.append(btn('＋ 制作模板', () => openMakeTemplateModal(skills || [])));
  topbarActions.append(btn('校验全部', async () => {
    const r = await api('/templates/validate', { method: 'POST' });
    openModal(el('div', { class: 'modal-card' },
      el('h3', {}, '模板校验结果（全部）'),
      el('div', { class: 'report' }, ...(r.reports || []).map((x) => el('div', { class: 'report-row ' + x.level }, `[${x.level}] ${x.module}: ${x.message}`))),
      el('div', { class: 'modal-actions' }, btn('关闭', closeModal, 'btn')),
    ));
  }));
  topbarActions.append(btn('刷新', renderTemplates));

  const tree = el('div', { class: 'tpl-tree' });
  const editor = el('div', { class: 'tpl-editor' });
  view.append(el('p', { class: 'hint' }, `模板来自「技能目录(src/skills/<技能>/templates/html)」。共 ${items?.length || 0} 个；每个模板下可挂载「紧密追问 / 其他追问」。`));
  view.append(el('div', { class: 'tpl-split' }, tree, editor));
  editor.append(el('div', { class: 'placeholder' }, '从左侧选择技能 / 模板 / 追问进行编辑。点击目录（技能或追问分组）可在右侧查看列表并支持「编辑 / 稽核」。'));

  const markActive = (node) => {
    tree.querySelectorAll('.tree-row.active').forEach((n) => n.classList.remove('active'));
    if (node) node.classList.add('active');
  };

  async function showSkillList(skill) {
    editor.innerHTML = '';
    editor.append(el('h3', {}, `技能：${skill}（模板列表）`));
    const wrap = el('div', { class: 'list' });
    for (const it of (bySkill[skill] || [])) {
      wrap.append(el('div', { class: 'list-item' },
        el('div', { class: 'li-main' },
          el('span', { class: 'li-title mono' }, it.id),
          el('span', { class: 'li-sub' }, it.description || ''),
        ),
        el('div', { class: 'li-ops' },
          el('button', { class: 'btn sm', onclick: () => showTemplate(it) }, '编辑'),
          el('button', { class: 'btn sm', onclick: () => auditTemplate(it.id) }, '稽核'),
        ),
      ));
    }
    editor.append(wrap);
  }

  async function showTemplate(it) {
    editor.innerHTML = '';
    const src = await api(`/templates/${it.id}/source`);
    if (!src.ok) return alert(src.error || '读取模板源码失败');
    editor.append(el('h3', {}, `编辑模板：${it.id}`));
    editor.append(el('div', { class: 'meta-row' },
      el('span', { class: 'badge info' }, it.skill),
      el('span', {}, `布局：${it.layout}`),
      el('span', {}, `${it.fields} 个字段`),
      el('span', { html: it.hasDefault ? badge('ok', '有默认') : badge('warn', '无默认') }),
      el('button', { class: 'btn sm', onclick: () => previewTemplate(it.id) }, '预览'),
      el('button', { class: 'btn sm', onclick: () => auditTemplate(it.id) }, '稽核此模板'),
    ));
    const htmlTa = el('textarea', { class: 'code', rows: '14', spellcheck: 'false' }, src.html);
    const defaultTa = el('textarea', { class: 'code', rows: '8', spellcheck: 'false' }, JSON.stringify(src.defaultData || {}, null, 2));
    const manifestTa = el('textarea', { class: 'code', rows: '8', spellcheck: 'false' }, src.manifest);
    const save = el('button', { class: 'btn primary' }, '保存模板');
    save.onclick = async () => {
      save.disabled = true; save.textContent = '保存中…';
      const r = await api(`/templates/${it.id}/source`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: htmlTa.value, manifest: manifestTa.value, defaultData: defaultTa.value }) });
      save.disabled = false; save.textContent = '保存模板';
      if (!r.ok) return alert('保存失败：' + (r.error || ''));
      alert('已保存');
    };
    editor.append(el('div', { class: 'field' }, el('label', {}, 'HTML 源码'), htmlTa));
    editor.append(el('div', { class: 'field' }, el('label', {}, '默认数据（JSON，内嵌于 HTML 的 <script type="application/json">）'), defaultTa));
    editor.append(el('div', { class: 'field' }, el('label', {}, 'Manifest（JSON）'), manifestTa));
    editor.append(el('div', { class: 'modal-actions' }, save));
  }

  function showGroup(skill, it, category) {
    editor.innerHTML = '';
    const title = category === 'tight' ? '紧密追问' : '其他追问';
    editor.append(el('h3', {}, `${it.id} · ${title}（列表）`));
    const arr = it.followups || [];
    const list = arr.filter((f) => (f.category || 'tight') === category);
    if (!list.length) editor.append(el('div', { class: 'placeholder' }, '暂无追问，可在下方新增。'));
    const wrap = el('div', { class: 'list' });
    list.forEach((f) => {
      const idx = arr.indexOf(f);
      wrap.append(el('div', { class: 'list-item' },
        el('div', { class: 'li-main' },
          el('span', { class: 'li-title' }, f.label),
          el('span', { class: 'li-sub mono' }, f.action_key || '（纯文本建议）'),
        ),
        el('div', { class: 'li-ops' },
          el('button', { class: 'btn sm', onclick: () => showFollowup(skill, it, idx) }, '编辑'),
          el('button', { class: 'btn sm danger', onclick: () => removeFollowup(skill, it, idx, category) }, '删除'),
        ),
      ));
    });
    editor.append(wrap);
    editor.append(el('div', { class: 'modal-actions' }, el('button', { class: 'btn', onclick: () => showFollowup(skill, it, -1, category) }, '＋ 新增追问')));
  }

  function showFollowup(skill, it, idx, presetCategory) {
    editor.innerHTML = '';
    const isNew = idx < 0;
    const f = isNew ? { label: '', user_prompt: '', action_key: '', category: presetCategory || 'tight', intent: '' } : (it.followups[idx] || {});
    const curCat = f.category === 'other' ? 'other' : 'tight';
    editor.append(el('h3', {}, `${isNew ? '新增' : '编辑'}追问：${it.id}`));
    const form = el('form', { class: 'formcard' });
    form.innerHTML = `
      <label>展示文案 (label) * <input name="label" value="${escAttr(f.label)}"></label>
      <label>发送给模型的提问 (user_prompt) * <input name="user_prompt" value="${escAttr(f.user_prompt)}"></label>
      <label>动作键 (action_key，可空) <input name="action_key" value="${escAttr(f.action_key)}" placeholder="如 travel_route.compare_destinations"></label>
      <label>意图 (intent，可空) <input name="intent" value="${escAttr(f.intent)}"></label>
      <label>分类
        <select name="category">
          <option value="tight" ${curCat !== 'other' ? 'selected' : ''}>紧密追问</option>
          <option value="other" ${curCat === 'other' ? 'selected' : ''}>其他追问</option>
        </select>
      </label>`;
    const save = el('button', { class: 'btn primary', type: 'submit' }, '保存追问');
    form.append(el('div', { class: 'modal-actions' }, save, !isNew ? el('button', { class: 'btn danger', type: 'button', onclick: () => removeFollowup(skill, it, idx, curCat) }, '删除') : el('span', {})));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form).entries());
      if (!fd.label || !fd.user_prompt) return alert('label 与 user_prompt 必填');
      const arr = it.followups ? it.followups.slice() : [];
      const entry = { label: fd.label, user_prompt: fd.user_prompt, category: fd.category === 'other' ? 'other' : 'tight' };
      if (fd.action_key) entry.action_key = fd.action_key;
      if (fd.intent) entry.intent = fd.intent;
      if (isNew) arr.push(entry); else arr[idx] = entry;
      it.followups = arr;
      const r = await api(`/templates/${it.id}/followups`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ followup_suggestions: arr }) });
      if (!r.ok) return alert('保存失败：' + (r.error || ''));
      buildTree();
      if (entry.category === curCat) showFollowup(skill, it, isNew ? arr.length - 1 : idx);
      else showGroup(skill, it, entry.category);
    };
    editor.append(form);
  }

  function removeFollowup(skill, it, idx, category) {
    if (!confirm('确认删除该追问？')) return;
    const arr = (it.followups || []).slice();
    arr.splice(idx, 1);
    it.followups = arr;
    api(`/templates/${it.id}/followups`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ followup_suggestions: arr }) })
      .then((r) => { if (!r.ok) alert('删除失败：' + (r.error || '')); else { buildTree(); showGroup(skill, it, category); } });
  }

  async function auditTemplate(id) {
    const r = await api('/templates/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    openModal(el('div', { class: 'modal-card' },
      el('h3', {}, `稽核：${id}`),
      el('div', { class: 'report' }, ...(r.reports || []).map((x) => el('div', { class: 'report-row ' + x.level }, `[${x.level}] ${x.module}: ${x.message}`))),
      el('div', { class: 'modal-actions' }, btn('关闭', closeModal, 'btn')),
    ));
  }

  function buildTree() {
    tree.innerHTML = '';
    for (const skill of skills) {
      const skillKids = el('div', { class: 'tree-kids' });
      const caret = el('span', { class: 'caret' }, '▾');
      const skillRow = el('div', { class: 'tree-row skill' }, caret, ` 📁 ${skill}`);
      caret.onclick = (e) => { e.stopPropagation(); skillKids.classList.toggle('collapsed'); caret.textContent = skillKids.classList.contains('collapsed') ? '▸' : '▾'; };
      skillRow.onclick = () => { markActive(skillRow); showSkillList(skill); };
      for (const it of (bySkill[skill] || [])) {
        const tKids = el('div', { class: 'tree-kids' });
        const tRow = el('div', { class: 'tree-row tpl' }, `📄 ${it.id}`);
        tRow.onclick = (e) => { e.stopPropagation(); markActive(tRow); showTemplate(it); };
        for (const category of ['tight', 'other']) {
          const label = category === 'tight' ? '🔒 紧密追问' : '💬 其他追问';
          const gKids = el('div', { class: 'tree-kids' });
          const gRow = el('div', { class: 'tree-row group' }, label);
          gRow.onclick = (e) => { e.stopPropagation(); markActive(gRow); showGroup(skill, it, category); };
          for (const f of (it.followups || []).filter((x) => (x.category || 'tight') === category)) {
            const fRow = el('div', { class: 'tree-row followup' }, `• ${f.label}`);
            fRow.onclick = (e) => { e.stopPropagation(); markActive(fRow); showFollowup(skill, it, it.followups.indexOf(f)); };
            gKids.append(fRow);
          }
          tKids.append(gRow, gKids);
        }
        skillKids.append(tRow, tKids);
      }
      tree.append(skillRow, skillKids);
    }
  }
  buildTree();
}
async function previewTemplate(id) {
  const r = await api(`/templates/preview/${id}`);
  if (!r.ok) return alert(r.error || '预览失败');
  const iframe = el('iframe', { class: 'preview-frame' });
  iframe.srcdoc = r.html;
  // 根据模板实际内容尺寸自适应预览框（srcdoc 同源，可直接测量）
  const fit = () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.documentElement) return;
      const w = Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth || 0);
      const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0);
      if (!w || !h) return;
      iframe.style.width = Math.min(w + 4, Math.floor(window.innerWidth * 0.9)) + 'px';
      iframe.style.height = Math.min(h + 4, Math.floor(window.innerHeight * 0.72)) + 'px';
    } catch { /* 忽略测量失败，保持默认尺寸 */ }
  };
  iframe.onload = () => { fit(); setTimeout(fit, 150); setTimeout(fit, 500); }; // 字体/图片加载后再校正
  openModal(el('div', { class: 'modal-card preview' },
    el('h3', {}, `预览：${r.id}`),
    iframe,
    el('div', { class: 'modal-actions' }, btn('关闭', closeModal, 'btn')),
  ));
}
// 制作模板：上传单个 HTML 文件或文件夹，调用 POST /api/admin/templates/make
function openMakeTemplateModal(skills) {
  const selected = [];
  const f = el('form', { class: 'modal-card wide' });
  const skillOpts = (skills && skills.length ? skills : ['common'])
    .map((s) => `<option value="${escAttr(s)}">${s}</option>`).join('');
  f.innerHTML = `
    <h3>制作模板</h3>
    <p class="hint">上传单个 HTML 文件或整个文件夹（含若干 .html）。系统会自动抽取内联样式、识别 {{占位符}}，并生成同名 .manifest.json，写入所选技能的 templates/html 目录。</p>
    <label>目标技能 <select name="skill">${skillOpts}</select></label>
    <label>布局 <select name="layout"><option value="card">card</option><option value="vertical">vertical</option><option value="horizontal">horizontal</option><option value="grid">grid</option></select></label>
    <label>说明（可选） <input name="description" placeholder="一句话描述模板用途，留空则按文件名生成"></label>
    <div class="upload-row">
      <button type="button" class="btn" id="pick-files">选择文件（可多选）</button>
      <button type="button" class="btn" id="pick-folder">选择文件夹</button>
      <span class="hint" id="file-count">未选择文件</span>
    </div>
    <input type="file" name="files" multiple id="file-input" hidden>
    <input type="file" name="folder" webkitdirectory multiple id="folder-input" hidden>
    <div class="modal-actions">
      <button type="button" class="btn" id="cancel">取消</button>
      <button type="submit" class="btn primary">生成并保存</button>
    </div>`;
  openModal(f);
  const fileInput = f.querySelector('#file-input');
  const folderInput = f.querySelector('#folder-input');
  const countEl = f.querySelector('#file-count');
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');
  const refresh = () => { countEl.textContent = selected.length ? `已选 ${selected.length} 个 HTML 文件` : '未选择文件'; };
  f.querySelector('#pick-files').onclick = () => fileInput.click();
  f.querySelector('#pick-folder').onclick = () => folderInput.click();
  fileInput.onchange = () => { for (const file of fileInput.files) selected.push(file); refresh(); };
  folderInput.onchange = () => { for (const file of folderInput.files) selected.push(file); refresh(); };
  f.querySelector('#cancel').onclick = closeModal;
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!selected.length) return alert('请先选择至少一个 HTML 文件');
    const fd = new FormData();
    fd.append('skill', f.querySelector('select[name=skill]').value);
    fd.append('layout', f.querySelector('select[name=layout]').value);
    fd.append('description', f.querySelector('input[name=description]').value);
    for (const file of selected) fd.append('files', file, file.name);
    const submit = f.querySelector('button[type=submit]');
    submit.disabled = true; submit.textContent = '生成中…';
    let j;
    try { j = await (await fetch(API + '/templates/make', { method: 'POST', body: fd })).json(); }
    catch (err) { submit.disabled = false; submit.textContent = '生成并保存'; return alert('请求失败：' + err.message); }
    submit.disabled = false; submit.textContent = '生成并保存';
    if (!j.ok) return alert('生成失败：' + (j.error || '') + (j.message ? ' - ' + j.message : ''));
    openModal(el('div', { class: 'modal-card' },
      el('h3', {}, '制作结果'),
      el('div', { class: 'report' }, ...(j.created || []).map((c) => el('div', { class: 'report-row ok' }, `✅ ${c.id} → ${c.path}`))),
      (j.skipped && j.skipped.length ? el('div', { class: 'report' }, ...j.skipped.map((s) => el('div', { class: 'report-row warn' }, `⚠️ ${s.file}：${s.reason}`))) : el('div', {})),
      el('div', { class: 'modal-actions' }, btn('关闭', () => { closeModal(); renderTemplates(); }, 'btn')),
    ));
  };
}

/* ============ 资源校验 ============ */
async function renderValidate() {
  const { reports } = await api('/validate');
  const count = { error: 0, warn: 0, ok: 0 };
  (reports || []).forEach((r) => count[r.level]++);
  topbarActions.append(btn('刷新', renderValidate));
  view.append(el('div', { class: 'summary' },
    el('span', { class: 'badge danger', html: `错误 ${count.error}` }),
    el('span', { class: 'badge warn', html: `警告 ${count.warn}` }),
    el('span', { class: 'badge ok', html: `正常 ${count.ok}` }),
  ));
  view.append(el('div', { class: 'report' }, ...(reports || []).map((x) => el('div', { class: 'report-row ' + x.level }, `[${x.level}] ${x.module}: ${x.message}`))));
}

/* ============ 运行日志 ============ */
async function renderLogs() {
  topbarActions.append(btn('🗑 清空日志', async () => {
    if (!confirm('确认清空运行日志（问题追踪 + 原始请求）？')) return;
    await api('/logs/clear', { method: 'POST' });
    renderLogs();
  }));
  topbarActions.append(btn('刷新', renderLogs));
  const { lines = [], traces = [], total_traces = 0, total = 0 } = await api('/logs');
  topbarActions.append(el('span', { class: 'hint' }, `问题追踪 ${total_traces} 条 · 原始请求 ${total} 条`));

  const box = el('div', { class: 'traces' });
  if (!traces.length) {
    box.append(el('div', { class: 'placeholder' }, '暂无问题追踪日志。发起对话或动作后，将自动记录每个问题的全环节耗时与路由。'));
  } else {
    for (const t of traces) {
      const lvlCls = t.level === 'error' ? 'err' : (t.level === 'warn' ? 'warn' : 'ok');
      const lvlText = t.level === 'error' ? '异常' : (t.level === 'warn' ? '警告' : '正常');
      const card = el('div', { class: 'trace ' + lvlCls });
      card.innerHTML = `
        <div class="trace-hd">
          <span class="badge ${lvlCls}">${lvlText}</span>
          <span class="trace-time">${esc(t.ts_bj || fmtBJ(t.ts))}</span>
          <span class="trace-kind">${esc(t.kind === 'action' ? '动作' : '对话')}</span>
          <span class="trace-q">${esc(t.question)}</span>
        </div>
        <div class="trace-sec">
          <div class="sec-t">路由</div>
          <div class="kvbox">${routeRows(t.route)}</div>
        </div>
        <div class="trace-sec">
          <div class="sec-t">环节（耗时）</div>
          <div class="stages">${(t.stages || []).map((s) => `<div class="trace-stage"><span class="st">${esc(s.label)}</span><span class="ms">+${s.ms}ms</span><span class="sd">${esc(typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail || ''))}</span></div>`).join('')}</div>
        </div>
        ${t.error ? `<div class="trace-err">异常：${esc(t.error)}</div>` : ''}
        <div class="trace-ids">${esc([t.conversation_id, t.turn_id, t.request_id].filter(Boolean).join(' · '))}</div>
      `;
      box.append(card);
    }
  }
  view.append(box);

  const details = el('details', { class: 'rawbox' });
  details.append(el('summary', {}, `原始请求日志（${lines.length}）`));
  details.append(el('pre', { class: 'rawlog' }, lines.map((o) => `${fmtBJ(o.ts)}  ${o.method || ''}  ${o.path || ''}  ${o.ip || ''}`).join('\n')));
  view.append(details);
}

function routeRows(route) {
  if (!route) return '<div class="muted">（无路由信息）</div>';
  const rows = [
    ['场景', route.scene_key],
    ['决策', route.decision],
    ['置信度', route.confidence != null ? (route.confidence * 100).toFixed(0) + '%' : '-'],
    ['已路由', route.routed ? '是' : '否'],
    ['模板原因', route.template_reason],
    ['知识状态', route.knowledge_status],
    ['本地知识', route.knowledge_local_status],
    ['远程知识', route.knowledge_remote_status],
    ['知识来源', route.knowledge_source],
    ['模型', route.model_used],
    ['模型错误', route.model_error],
    ['渲染状态', route.render_status],
  ];
  return rows.filter(([, v]) => v != null && v !== '' && v !== false)
    .map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
}

/* ============ 对话运行 ============ */
async function renderDialogue() {
  const { items: models } = await api('/models');
  const sel = el('select', { name: 'modelId' }, ...models.map((m) => el('option', { value: m.id, ...(m.is_default ? { selected: '' } : {}) }, `${m.name}（${m.is_active ? '启用' : '停用'}）`)));
  const ta = el('textarea', { name: 'message', rows: '4', placeholder: '输入测试消息，查看模型回复信封…' });
  const out = el('pre', { class: 'result' }, '（回复将显示在这里）');
  const send = btn('发送', async () => {
    out.textContent = '请求中…';
    const r = await api('/dialogue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: ta.value, modelId: sel.value }) });
    out.textContent = JSON.stringify(r, null, 2);
  });
  view.append(el('div', { class: 'formcard' },
    el('label', {}, '模型'), sel,
    el('label', {}, '消息'), ta,
    el('div', { class: 'modal-actions' }, send),
    out,
  ));
}

/* ============ 权限矩阵 ============ */
/* ============ 权限矩阵（角色 × 技能，权限矩阵）============ */
async function renderPermissions() {
  let state = await api('/permissions'); // { roles, skills }
  state.roles = state.roles || [];
  state.skills = state.skills || [];
  let q = '';
  let matrixWrap = null;

  const metric = (label, val) => el('div', { class: 'metric' },
    el('div', { class: 'val' }, String(val)), el('div', { class: 'lbl' }, label));
  const metrics = () => {
    const { roles, skills } = state;
    const allowed = roles.reduce((n, r) => n + (r.wildcard ? skills.length : (r.skills || []).length), 0);
    const cov = roles.length * skills.length ? Math.round((allowed / (roles.length * skills.length)) * 100) : 0;
    return el('div', { class: 'metrics' },
      metric('角色数', roles.length), metric('技能数', skills.length),
      metric('允许数', allowed), metric('平均覆盖率', cov + '%'));
  };

  const renderMatrix = () => {
    const skills = state.skills.filter((s) => s.toLowerCase().includes(q.toLowerCase()));
    const head = el('tr', {}, el('th', {}, '技能 \\ 角色'),
      ...state.roles.map((r) => el('th', { class: 'center' }, (r.wildcard ? '★ ' : '') + r.cn_name + `（${r.key}）`)));
    const rows = skills.map((s) => el('tr', {},
      el('td', { class: 'mono' }, s),
      ...state.roles.map((r) => {
        const on = r.wildcard || (r.skills || []).includes(s);
        const cell = el('td', { class: 'cell ' + (on ? 'on' : 'off') + (r.wildcard ? ' locked' : '') }, on ? (r.wildcard ? '★' : '✓') : '');
        if (!r.wildcard) cell.onclick = () => {
          const arr = r.skills || (r.skills = []);
          const i = arr.indexOf(s);
          if (i >= 0) arr.splice(i, 1); else arr.push(s);
          refreshMatrix();
        };
        return cell;
      })));
    const tbody = el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colspan: state.roles.length + 1, class: 'hint' }, '无匹配技能'))]));
    return el('table', { class: 'grid matrix' }, el('thead', {}, head), tbody);
  };
  const refreshMatrix = () => {
    const nw = renderMatrix();
    if (matrixWrap && matrixWrap.parentNode) view.replaceChild(nw, matrixWrap);
    else view.append(nw);
    matrixWrap = nw;
  };

  const roleCard = (r) => el('div', { class: 'role-card' },
    el('div', { class: 'rc-head' }, el('strong', {}, (r.wildcard ? '★ ' : '') + r.cn_name), el('span', { class: 'muted' }, ` ${r.key}`)),
    el('div', { class: 'rc-skills' }, r.wildcard ? '全部技能（通配）' : ((r.skills || []).join('、') || '（无技能）')),
    el('div', { class: 'ops' },
      (() => { const b = el('button', { class: 'btn sm' }, '编辑'); b.onclick = () => openRoleForm(r); return b; })(),
      (() => { const b = el('button', { class: 'btn sm danger' }, '删除'); b.onclick = async () => { if (confirm(`删除角色「${r.cn_name}」？`)) { await api(`/permissions/roles/${r.key}`, { method: 'DELETE' }); state = await api('/permissions'); renderAll(); } }; return b; })(),
    ));

  const openRoleForm = (it) => {
    const isEdit = !!it;
    const f = el('form', { class: 'modal-card' });
    const skBoxes = state.skills.map((s) => `<label class="check"><input type="checkbox" name="sk_${escAttr(s)}" ${it && (it.skills || []).includes(s) ? 'checked' : ''}> ${escAttr(s)}</label>`).join('');
    f.innerHTML = `
      <h3>${isEdit ? '编辑角色' : '新建角色'}</h3>
      <label>角色 key（唯一）* <input name="key" value="${escAttr(it?.key)}" ${isEdit ? 'readonly' : ''}></label>
      <label>中文名 <input name="cn_name" value="${escAttr(it?.cn_name)}"></label>
      <label class="check"><input type="checkbox" name="wildcard" ${it?.wildcard ? 'checked' : ''}> 通配（拥有全部技能）</label>
      <div class="field-group"><div class="lbl">授权技能</div>${skBoxes || '<span class="hint">（暂无可用的技能目录）</span>'}</div>
      <div class="modal-actions"><button type="button" class="btn" id="cancel">取消</button><button type="submit" class="btn primary">保存</button></div>`;
    openModal(f);
    f.querySelector('#cancel').onclick = closeModal;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const skills = state.skills.filter((s) => f.querySelector(`input[name="sk_${s}"]`).checked);
      const body = { key: f.querySelector('input[name=key]').value, cn_name: f.querySelector('input[name=cn_name]').value, wildcard: f.querySelector('input[name=wildcard]').checked, skills };
      const r = isEdit
        ? await api(`/permissions/roles/${it.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await api('/permissions/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) return alert('保存失败：' + (r.error || ''));
      closeModal();
      state = await api('/permissions');
      renderAll();
    };
  };

  const renderAll = () => {
    topbarActions.innerHTML = '';
    view.innerHTML = '';
    view.append(metrics());
    const bar = el('div', { class: 'toolbar' });
    const search = el('input', { class: 'search', placeholder: '搜索技能…' });
    search.oninput = () => { q = search.value; refreshMatrix(); };
    bar.append(search);
    view.append(bar);
    refreshMatrix();
    view.append(el('h3', { class: 'section-title' }, '角色清单'));
    view.append(el('div', { class: 'role-list' }, ...(state.roles.length ? state.roles.map(roleCard) : [el('div', { class: 'hint' }, '暂无角色，点击右上角新建或从代码同步默认')])));
    topbarActions.append(btn('＋ 新建角色', () => openRoleForm(null)));
    topbarActions.append(btn('同步默认', async () => { if (confirm('重置为默认角色×技能矩阵？')) { state = await api('/permissions/sync', { method: 'POST' }); renderAll(); } }));
    topbarActions.append(btn('保存矩阵', async () => {
      await api('/permissions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles: state.roles }) });
      alert('已保存');
    }));
  };
  renderAll();
}

/* ============ 通用 CRUD（知识导入 / 系统配置）============ */
const CRUD = {
  knowledge: {
    label: '知识导入', file: 'knowledge',
    cols: [{ key: 'title', label: '标题' }, { key: 'source', label: '来源' }, { key: 'status', label: '状态', html: (it) => badge('ok', it.status || '-') }, { key: 'imported_at', label: '导入时间' }],
    fields: [{ name: 'title', label: '标题' }, { name: 'source', label: '来源路径' }, { name: 'status', label: '状态' }],
  },
  config: {
    label: '系统配置', file: 'config',
    cols: [{ key: 'key', label: '键' }, { key: 'value', label: '值' }, { key: 'group', label: '分组' }, { key: 'desc', label: '说明' }],
    fields: [{ name: 'key', label: '键' }, { name: 'value', label: '值' }, { name: 'group', label: '分组' }, { name: 'desc', label: '说明' }],
  },
};
async function renderCrud(cfg) {
  const { items } = await api('/registries/' + cfg.file);
  topbarActions.append(btn('＋ 新建' + cfg.label, () => openFormModal(cfg.fields, null, async (fd) => {
    await api('/registries/' + cfg.file, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    renderCrud(cfg);
  }, '新建' + cfg.label)));
  const rows = (items || []).map((it) => el('tr', {},
    ...cfg.cols.map((c) => c.html ? el('td', { html: c.html(it) }) : el('td', {}, it[c.key] ?? '-')),
    el('td', { class: 'ops' },
      (() => { const e = el('button', { class: 'btn sm' }, '编辑'); e.onclick = () => openFormModal(cfg.fields, it, async (fd) => { await api(`/registries/${cfg.file}/${it.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) }); renderCrud(cfg); }, '编辑' + cfg.label); return e; })(),
      (() => { const d = el('button', { class: 'btn sm danger' }, '删除'); d.onclick = async () => { if (confirm('删除该项？')) { await api(`/registries/${cfg.file}/${it.id}`, { method: 'DELETE' }); renderCrud(cfg); } }; return d; })(),
    ),
  ));
  view.append(el('table', { class: 'grid' },
    el('thead', {}, el('tr', {}, ...cfg.cols.map((c) => el('th', {}, c.label)).concat(el('th', {}, '操作')))),
    el('tbody', {}, ...rows),
  ));
}

/* ============ 第三方API（第三方 API，适配为入站 API）============ */
const AUTH_TYPE_LABEL = { none: '无', bearer: 'Bearer', header: '请求头', query: 'Query参数' };
async function renderIntegrations() {
  const { items } = await api('/integrations');
  topbarActions.append(btn('＋ 新建集成', () => openIntegrationForm(null)));
  view.append(el('p', { class: 'hint' },
    '第三方 API 目录（原「外部服务」登记已并入本目录，分类为「外部服务(迁入)」），已适配为 flatTalk 入站 API：调用方访问「入站路径/原第三方接口路径」，网关自动注入密钥并转发。例：GET /api/ext/tencent_map/ws/geocoder/v1/?address=南宁。密钥可在此配置，留空则回退环境变量。'));
  const rows = (items || []).map((it) => el('tr', {},
    el('td', {}, it.name),
    el('td', {}, it.category || '-'),
    el('td', { class: 'desc', title: it.description || '' }, it.description || '-'),
    el('td', { class: 'mono desc', title: it.base_url_resolved || '' }, it.base_url_resolved || '（未配置）'),
    el('td', { class: 'mono' }, it.inbound_path + '/*'),
    el('td', { html: it.has_secret ? badge('ok', it.secret_masked || '已配置') : (it.env_present?.length ? badge('info', 'ENV') : badge('muted', '无密钥')) }),
    el('td', { html: (it.status === 'active' ? badge('ok', '启用') : badge('warn', '停用')) + (it.last_test ? ' ' + badge(it.last_test.ok ? 'ok' : 'warn', it.last_test.ok ? '连通' : '不通') : '') }),
    el('td', { class: 'ops' }, ...integrationOps(it)),
  ));
  view.append(el('table', { class: 'grid' },
    el('thead', {}, el('tr', {}, ...['名称', '分类', '说明', '基地址', '入站路径', '密钥', '状态', '操作'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...rows),
  ));
}
function integrationOps(it) {
  const test = el('button', { class: 'btn sm' }, '测试');
  test.onclick = async () => {
    test.textContent = '测试中…'; test.disabled = true;
    const r = await api(`/integrations/${it.id}/test`, { method: 'POST' });
    const x = r.result || {};
    alert(x.ok
      ? `连通 ✅  HTTP ${x.status}  耗时 ${x.latency_ms}ms\n${(x.snippet || '').slice(0, 200)}`
      : `失败 ❌  ${x.message || x.error || ''}${x.status ? '  HTTP ' + x.status : ''}`);
    renderIntegrations();
  };
  const edit = el('button', { class: 'btn sm' }, '编辑');
  edit.onclick = () => openIntegrationForm(it);
  const tog = el('button', { class: 'btn sm' }, it.status === 'active' ? '停用' : '启用');
  tog.onclick = async () => { await api(`/integrations/${it.id}/${it.status === 'active' ? 'disable' : 'enable'}`, { method: 'POST' }); renderIntegrations(); };
  const del = el('button', { class: 'btn sm danger' }, '删除');
  del.onclick = async () => { if (confirm(`删除集成「${it.name}」？`)) { await api(`/integrations/${it.id}`, { method: 'DELETE' }); renderIntegrations(); } };
  return [test, edit, tog, del];
}
function openIntegrationForm(it) {
  const isEdit = !!it;
  const f = el('form', { class: 'modal-card' });
  const authOpts = Object.entries(AUTH_TYPE_LABEL)
    .map(([v, l]) => `<option value="${v}" ${it?.auth_type === v ? 'selected' : ''}>${l}</option>`).join('');
  f.innerHTML = `
    <h3>${isEdit ? '编辑集成' : '新建集成'}</h3>
    <label>标识 key（唯一，入站路径 /api/ext/&lt;key&gt;）* <input name="key" value="${escAttr(it?.key)}" ${isEdit ? 'readonly' : ''}></label>
    <label>名称* <input name="name" value="${escAttr(it?.name)}"></label>
    <label>分类 <input name="category" value="${escAttr(it?.category)}"></label>
    <label>基地址 base_url <input name="base_url" value="${escAttr(it?.base_url)}" placeholder="https://api.example.com（留空回退环境变量）"></label>
    <label>鉴权方式 <select name="auth_type">${authOpts}</select></label>
    <label>鉴权字段名（header/query 时生效） <input name="auth_name" value="${escAttr(it?.auth_name)}" placeholder="如 X-API-Key 或 key"></label>
    <label>密钥 ${isEdit ? '（留空不改）' : ''} <input name="api_key" type="password" placeholder="服务端保存，不回显"></label>
    <label>测试路径 <input name="test_path" value="${escAttr(it?.test_path || '/')}"></label>
    <label>关联环境变量（逗号分隔） <input name="env_keys" value="${escAttr((it?.env_keys || []).join(','))}"></label>
    <label>说明 <input name="description" value="${escAttr(it?.description)}"></label>
    <div class="modal-actions">
      <button type="button" class="btn" id="cancel">取消</button>
      <button type="submit" class="btn primary">保存</button>
    </div>`;
  openModal(f);
  f.querySelector('#cancel').onclick = closeModal;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f).entries());
    if (!fd.api_key) delete fd.api_key;
    const r = isEdit
      ? await api(`/integrations/${it.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) })
      : await api('/integrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    if (!r.ok) return alert('保存失败：' + (r.error || ''));
    closeModal();
    renderIntegrations();
  };
}

/* ============ Open API 管理 ============ */
async function renderOpenApi() {
  const [cat, keys] = await Promise.all([api('/openapi/catalog'), api('/openapi/keys')]);
  topbarActions.append(btn('＋ 生成密钥', async () => {
    const name = prompt('密钥名称（用途备注）：', '默认密钥');
    if (name == null) return;
    const r = await api('/openapi/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (r.ok) {
      openModal(el('div', { class: 'modal-card' },
        el('h3', {}, '密钥已生成（仅本次完整显示）'),
        el('pre', { class: 'codebox' }, r.item.key),
        el('p', { class: 'hint' }, '生成启用密钥后，Open API 将要求携带 Authorization: Bearer <key> 或 X-API-Key 请求头。'),
        el('div', { class: 'modal-actions' },
          btn('复制', () => navigator.clipboard.writeText(r.item.key), 'btn'),
          btn('关闭', () => { closeModal(); renderOpenApi(); }, 'btn primary')),
      ));
    }
  }));

  view.append(el('h3', { class: 'section-title' }, 'API 密钥'),
    el('p', { class: 'hint' }, cat.auth_required
      ? '当前 Open API 已启用鉴权：调用需携带有效密钥（或嵌入 token）。'
      : '当前无启用密钥且未强制鉴权，Open API 处于开放模式；生成密钥后自动启用鉴权。'));
  const keyRows = (keys.items || []).map((k) => el('tr', {},
    el('td', {}, String(k.id)),
    el('td', {}, k.name),
    el('td', { class: 'mono' }, k.key_masked || '-'),
    el('td', { html: k.enabled !== false ? badge('ok', '启用') : badge('warn', '停用') }),
    el('td', {}, String(k.call_count || 0)),
    el('td', {}, (k.created_at || '').slice(0, 19).replace('T', ' ')),
    el('td', { class: 'ops' },
      (() => { const b = el('button', { class: 'btn sm' }, '复制'); b.onclick = async () => { const r = await api(`/openapi/keys/${k.id}/reveal`); if (r.ok) { await navigator.clipboard.writeText(r.key); b.textContent = '已复制'; setTimeout(() => (b.textContent = '复制'), 1200); } }; return b; })(),
      (() => { const b = el('button', { class: 'btn sm' }, k.enabled !== false ? '停用' : '启用'); b.onclick = async () => { await api(`/openapi/keys/${k.id}/${k.enabled !== false ? 'disable' : 'enable'}`, { method: 'POST' }); renderOpenApi(); }; return b; })(),
      (() => { const b = el('button', { class: 'btn sm danger' }, '删除'); b.onclick = async () => { if (confirm(`删除密钥「${k.name}」？`)) { await api(`/openapi/keys/${k.id}`, { method: 'DELETE' }); renderOpenApi(); } }; return b; })(),
    ),
  ));
  view.append(el('table', { class: 'grid' },
    el('thead', {}, el('tr', {}, ...['ID', '名称', '密钥', '状态', '调用数', '创建时间', '操作'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...(keyRows.length ? keyRows : [el('tr', {}, el('td', { colspan: '7', class: 'hint' }, '暂无密钥'))])),
  ));

  view.append(el('h3', { class: 'section-title' }, '接口目录'));
  const catRows = (cat.items || []).map((c) => el('tr', {},
    el('td', { html: badge(c.method === 'GET' ? 'info' : 'ok', c.method) }),
    el('td', { class: 'mono' }, c.path),
    el('td', {}, c.name),
    el('td', { class: 'desc', title: c.description || '' }, c.description || '-'),
    el('td', {}, c.auth || '-'),
    el('td', { class: 'ops' },
      (() => { const b = el('button', { class: 'btn sm' }, '测试'); b.onclick = () => openApiTestModal(c, keys.items || []); if (c.method === 'ANY') b.disabled = true; return b; })(),
    ),
  ));
  view.append(el('table', { class: 'grid' },
    el('thead', {}, el('tr', {}, ...['方法', '路径', '名称', '说明', '鉴权', '操作'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...catRows),
  ));
}
function openApiTestModal(c, keys) {
  const f = el('form', { class: 'modal-card wide' });
  const keyOpts = ['<option value="">（不带密钥）</option>']
    .concat(keys.filter((k) => k.enabled !== false).map((k) => `<option value="${k.id}">${escAttr(k.name)}</option>`)).join('');
  f.innerHTML = `
    <h3>测试：${escAttr(c.name)}</h3>
    <label>方法 <select name="method"><option ${c.method === 'GET' ? 'selected' : ''}>GET</option><option ${c.method === 'POST' ? 'selected' : ''}>POST</option><option>PUT</option><option>DELETE</option></select></label>
    <label>路径 <input name="path" value="${escAttr(c.path)}"></label>
    <label>API 密钥 <select name="key_id">${keyOpts}</select></label>
    <label>请求体（JSON） <textarea name="body" rows="7">${c.sample ? escAttr(JSON.stringify(c.sample, null, 2)) : ''}</textarea></label>
    <pre class="codebox" id="test-out">（响应将显示在这里）</pre>
    <div class="modal-actions">
      <button type="button" class="btn" id="cancel">关闭</button>
      <button type="submit" class="btn primary">发送</button>
    </div>`;
  openModal(f);
  f.querySelector('#cancel').onclick = closeModal;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const out = f.querySelector('#test-out');
    out.textContent = '请求中…';
    let apiKey = '';
    const keyId = f.querySelector('select[name=key_id]').value;
    if (keyId) { const r = await api(`/openapi/keys/${keyId}/reveal`); apiKey = r.key || ''; }
    const r = await api('/openapi/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: f.querySelector('select[name=method]').value,
        path: f.querySelector('input[name=path]').value,
        body: f.querySelector('textarea[name=body]').value || undefined,
        api_key: apiKey || undefined,
      }),
    });
    const x = r.result || {};
    let bodyText = x.body || x.error || '';
    try { bodyText = JSON.stringify(JSON.parse(bodyText), null, 2); } catch {}
    out.textContent = `HTTP ${x.status}  耗时 ${x.latency_ms}ms\n\n${bodyText}`;
  };
}

/* ============ 认证接入 ============ */
async function renderAuthAccess() {
  const { config } = await api('/access/sso');
  const sso = config.sso || {};
  const f = el('form', { class: 'formcard' });
  f.innerHTML = `
    <p class="hint">配置业务系统 SSO 单点登录与 Open API 鉴权策略。SSO 开关会同步到前端 /api/client-config（businessSsoEnabled）。</p>
    <label class="check"><input type="checkbox" name="enabled" ${sso.enabled ? 'checked' : ''}> 启用业务系统 SSO</label>
    <label>提供方 <input name="provider" value="${escAttr(sso.provider || 'business')}"></label>
    <label>登录地址 login_url <input name="login_url" value="${escAttr(sso.login_url)}" placeholder="https://sso.example.com/login"></label>
    <label>令牌校验地址 token_check_url <input name="token_check_url" value="${escAttr(sso.token_check_url)}" placeholder="https://sso.example.com/api/token/check"></label>
    <label>client_id <input name="client_id" value="${escAttr(sso.client_id)}"></label>
    <label>client_secret（留空不改，当前：${sso.has_client_secret ? escAttr(sso.client_secret_masked) : '未配置'}） <input name="client_secret" type="password" placeholder="服务端保存，不回显"></label>
    <label class="check"><input type="checkbox" name="require_key" ${config.api_auth?.require_key ? 'checked' : ''}> Open API 强制密钥鉴权（即使未生成密钥也拒绝匿名调用）</label>
    <div class="modal-actions">
      <button type="button" class="btn" id="test-sso">连通测试</button>
      <button type="submit" class="btn primary">保存</button>
    </div>
    <pre class="codebox" id="sso-out" style="display:none"></pre>`;
  view.append(f);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      sso: {
        enabled: f.querySelector('input[name=enabled]').checked,
        provider: f.querySelector('input[name=provider]').value,
        login_url: f.querySelector('input[name=login_url]').value,
        token_check_url: f.querySelector('input[name=token_check_url]').value,
        client_id: f.querySelector('input[name=client_id]').value,
        client_secret: f.querySelector('input[name=client_secret]').value || undefined,
      },
      api_auth: { require_key: f.querySelector('input[name=require_key]').checked },
    };
    const r = await api('/access/sso', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    alert(r.ok ? '已保存' : '保存失败：' + (r.error || ''));
  };
  f.querySelector('#test-sso').onclick = async () => {
    const out = f.querySelector('#sso-out');
    out.style.display = 'block';
    out.textContent = '测试中…';
    const r = await api('/access/sso/test', { method: 'POST' });
    const rep = r.report || {};
    out.textContent =
      `本机 dev-login 自检：${rep.dev_login?.ok ? '✅' : '❌'} ${JSON.stringify(rep.dev_login)}\n` +
      `远端 SSO 连通：${rep.remote?.skipped ? '（跳过）' + rep.remote.message : (rep.remote?.ok ? '✅' : '❌') + ' ' + JSON.stringify(rep.remote)}`;
  };
}

/* ============ 第三方嵌入 ============ */
async function renderEmbeds() {
  const { items } = await api('/embeds');
  topbarActions.append(btn('＋ 新建嵌入点', () => openEmbedForm(null)));
  view.append(el('p', { class: 'hint' },
    '为外部网站/系统生成可嵌入的 flatTalk 对话组件。每个嵌入点有独立 token（同时作为 Open API 通行凭证），可停用即时吊销。'));
  const rows = (items || []).map((it) => el('tr', {},
    el('td', {}, String(it.id)),
    el('td', {}, it.name),
    el('td', { class: 'mono desc', title: it.token }, it.token),
    el('td', {}, it.default_role || '-'),
    el('td', {}, it.skill_key || '（自动路由）'),
    el('td', {}, it.theme || 'light'),
    el('td', { html: it.enabled !== false ? badge('ok', '启用') : badge('warn', '停用') }),
    el('td', { class: 'ops' },
      (() => { const b = el('button', { class: 'btn sm' }, '代码'); b.onclick = () => openEmbedSnippet(it); return b; })(),
      (() => { const b = el('button', { class: 'btn sm' }, '预览'); b.onclick = () => window.open(`/embed.html?token=${encodeURIComponent(it.token)}`, '_blank'); return b; })(),
      (() => { const b = el('button', { class: 'btn sm' }, '编辑'); b.onclick = () => openEmbedForm(it); return b; })(),
      (() => { const b = el('button', { class: 'btn sm' }, it.enabled !== false ? '停用' : '启用'); b.onclick = async () => { await api(`/embeds/${it.id}/${it.enabled !== false ? 'disable' : 'enable'}`, { method: 'POST' }); renderEmbeds(); }; return b; })(),
      (() => { const b = el('button', { class: 'btn sm danger' }, '删除'); b.onclick = async () => { if (confirm(`删除嵌入点「${it.name}」？`)) { await api(`/embeds/${it.id}`, { method: 'DELETE' }); renderEmbeds(); } }; return b; })(),
    ),
  ));
  view.append(el('table', { class: 'grid' },
    el('thead', {}, el('tr', {}, ...['ID', '名称', 'Token', '默认角色', '绑定技能', '主题', '状态', '操作'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colspan: '8', class: 'hint' }, '暂无嵌入点，点击右上角新建'))])),
  ));
}
function openEmbedForm(it) {
  openFormModal([
    { name: 'name', label: '名称' },
    { name: 'default_role', label: '默认角色（elder/family/admin…）' },
    { name: 'skill_key', label: '绑定技能 key（留空自动路由）' },
    { name: 'theme', label: '主题（light/dark）' },
    { name: 'welcome', label: '欢迎语' },
    { name: 'allowed_origins', label: '允许来源（* 或域名列表）' },
  ], it, async (fd) => {
    if (it) await api(`/embeds/${it.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    else await api('/embeds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    renderEmbeds();
  }, it ? '编辑嵌入点' : '新建嵌入点');
}
function openEmbedSnippet(it) {
  const origin = location.origin;
  const iframeCode = `<iframe src="${origin}/embed.html?token=${it.token}"\n  style="width:380px;height:560px;border:0;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.15)"\n  allow="clipboard-write"></iframe>`;
  const scriptCode = `<script>\n(function () {\n  var f = document.createElement('iframe');\n  f.src = '${origin}/embed.html?token=${it.token}';\n  f.style.cssText = 'position:fixed;right:24px;bottom:24px;width:380px;height:560px;border:0;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.2);z-index:9999';\n  document.body.appendChild(f);\n})();\n<\/script>`;
  openModal(el('div', { class: 'modal-card wide' },
    el('h3', {}, `嵌入代码：${it.name}`),
    el('p', { class: 'hint' }, '方式一：iframe 直接嵌入页面指定位置'),
    el('pre', { class: 'codebox' }, iframeCode),
    el('p', { class: 'hint' }, '方式二：script 挂角标浮窗'),
    el('pre', { class: 'codebox' }, scriptCode),
    el('div', { class: 'modal-actions' },
      btn('复制 iframe', () => navigator.clipboard.writeText(iframeCode), 'btn'),
      btn('复制 script', () => navigator.clipboard.writeText(scriptCode), 'btn'),
      btn('关闭', closeModal, 'btn primary')),
  ));
}

showModule('models');
