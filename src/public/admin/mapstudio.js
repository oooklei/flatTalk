// 地图SVG制作工坊交互逻辑（ES module）
// 用法：注入 mapstudio.html 到 #view 后调用 initMapStudio(view)

const API = '/api/admin/mapstudio';

// 标点类型 → 中文标签（与后端 TYPE_LABELS 对齐）
const TYPE_LABEL = {
  base: '基（基地）',
  arrival: '抵（到达）',
  spot: '景（景点）',
  wellness: '养（康养）',
  departure: '返（返程）',
};
// 标点类型 → 单字缩写（用于 SVG 圆点内文字，与后端一致）
const TYPE_ABBR = {
  base: '基', arrival: '抵', spot: '景', wellness: '养', departure: '返',
};
// 标点类型 → 配色（与后端 TYPE_COLORS 对齐）
const TYPE_COLOR = {
  base: '#2E7D32', arrival: '#2E7D32',
  spot: '#FF7826', wellness: '#1976D2', departure: '#D32F2F',
};

// 工坊运行时状态
const state = {
  routeId: '',            // 当前选中的线路ID
  version: 'standard',    // 当前显示的版本 standard / elder
  routes: [],             // 线路列表
  waypoints: [],          // 当前线路标点（来自 /data 或 /pipeline 的 route_data.waypoints）
  routeData: null,        // pipeline 返回的完整路线数据
  svgStandard: '',        // 标准版 SVG 字符串
  svgElder: '',           // 适老版 SVG 字符串
  stats: null,            // pipeline 返回的统计信息 { poi_count, tavily_count, polyline_points }
  selectedIdx: -1,        // 选中的标点在 waypoints 数组中的下标
};

// DOM 引用缓存（initMapStudio 时基于 root 填充）
const dom = {};
// 当前选中的 SVG 标点 <g> 元素（null 表示无选中）
let selectedMarkerEl = null;
// 信息浮层元素
let infoPopup = null;

/* ---------- 通用工具 ---------- */
// 文本转义（防注入）
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// 属性值转义
const escAttr = (s) => String(s ?? '').replace(/"/g, '&quot;');

// 统一 fetch 封装
async function api(path, opts) {
  const r = await fetch(API + path, opts);
  return r.json();
}

// 取当前画布中的 <svg> 元素
function svgEl() {
  return dom.canvas ? dom.canvas.querySelector('svg') : null;
}

// 解析 transform="translate(x,y)" 的位移量
function parseTranslate(str) {
  const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(str || '');
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
}

// 序列化当前画布 SVG 为字符串
function serializeSvg() {
  const svg = svgEl();
  return svg ? new XMLSerializer().serializeToString(svg) : '';
}

// 在 SVG 中按名称查找标点 <g> 元素
function findMarkerByName(svg, name) {
  let found = null;
  svg.querySelectorAll('.marker').forEach((g) => {
    if (!found && (g.getAttribute('data-name') || '') === name) found = g;
  });
  return found;
}

/* ---------- 线路加载 ---------- */
// 加载线路列表，填充下拉框
async function loadRoutes() {
  try {
    const r = await api('/routes');
    state.routes = r.routes || [];
    dom.routeSelect.innerHTML =
      '<option value="">请选择线路…</option>' +
      state.routes
        .map((rt) => `<option value="${escAttr(rt.product_id)}">${esc(rt.product_name || rt.product_id)}${rt.destination ? ' · ' + esc(rt.destination) : ''}</option>`)
        .join('');
  } catch (e) {
    dom.routeSelect.innerHTML = '<option value="">加载线路失败</option>';
    setStatus('线路加载失败', 'err');
  }
}

// 选择线路后加载标点数据
async function loadRouteData(routeId) {
  if (!routeId) {
    state.routeId = '';
    state.waypoints = [];
    state.routeData = null;
    state.svgStandard = '';
    state.svgElder = '';
    state.stats = null;
    state.selectedIdx = -1;
    selectedMarkerEl = null;
    renderMarkerList();
    renderStats();
    clearCanvas();
    setStatus('');
    return;
  }
  state.routeId = routeId;
  state.selectedIdx = -1;
  selectedMarkerEl = null;
  try {
    const r = await api('/data/' + encodeURIComponent(routeId));
    const route = r.route || {};
    state.waypoints = (route.waypoints || []).map((w) => ({ ...w }));
    renderMarkerList();
    hideMarkerForm();
    hideInfoPopup();
    clearCanvas();
    renderStats();
    setStatus(`已加载 ${state.waypoints.length} 个标点，点击「一键生成」绘制地图`);
  } catch (e) {
    setStatus('加载线路数据失败：' + e.message, 'err');
  }
}

/* ---------- 一键生成（POST /pipeline） ---------- */
async function generate() {
  if (!state.routeId) { setStatus('请先选择线路', 'warn'); return; }
  if (!state.waypoints.length) { setStatus('当前线路无标点数据', 'warn'); return; }
  const btn = dom.btnGenerate;
  btn.disabled = true;
  btn.textContent = '生成中…';
  setStatus('正在采集数据（POI / 路径 / Tavily），请稍候…');
  showSpinner(true);
  try {
    const r = await api('/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_id: state.routeId }),
    });
    if (!r.ok) { setStatus('生成失败：' + (r.error || '未知错误'), 'err'); return; }
    // 保存返回数据
    state.routeData = r.route_data || null;
    state.waypoints = ((r.route_data && r.route_data.waypoints) || state.waypoints).map((w) => ({ ...w }));
    state.svgStandard = r.svg_standard || '';
    state.svgElder = r.svg_elder || '';
    state.stats = r.stats || null;
    state.selectedIdx = -1;
    selectedMarkerEl = null;
    // 渲染当前版本
    renderSvg(state.version);
    bindMarkers();
    renderMarkerList();
    renderStats();
    setStatus('生成完成');
  } catch (e) {
    setStatus('请求失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '一键生成';
    showSpinner(false);
  }
}

/* ---------- SVG 渲染 ---------- */
function clearCanvas() {
  dom.canvas.innerHTML = '<div class="ms-empty">选择线路并点击「一键生成」开始制作地图</div>';
}

// 将指定版本的 SVG 字符串渲染到画布
function renderSvg(version) {
  const svgStr = version === 'elder' ? state.svgElder : state.svgStandard;
  if (!svgStr) {
    dom.canvas.innerHTML = '<div class="ms-empty">暂无地图，请点击「一键生成」</div>';
    return;
  }
  dom.canvas.innerHTML = svgStr;
  const svg = svgEl();
  if (svg) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
}

/* ---------- 标点交互：绑定 / 选中 / 编辑 / 拖拽 ---------- */
// 绑定所有标点的拖拽事件（点击通过 mouseup 判定）
function bindMarkers() {
  const svg = svgEl();
  if (!svg) return;
  svg.querySelectorAll('.marker').forEach((g) => {
    g.addEventListener('mousedown', (e) => startDrag(g, e));
  });
}

// 从 SVG 标点选中：高亮 + 填充表单 + 弹出信息浮层
function selectMarker(g) {
  if (selectedMarkerEl) selectedMarkerEl.classList.remove('selected');
  selectedMarkerEl = g;
  if (!g) {
    state.selectedIdx = -1;
    hideMarkerForm();
    hideInfoPopup();
    return;
  }
  g.classList.add('selected');
  // 按名称找到 waypoints 下标
  const name = g.getAttribute('data-name') || '';
  state.selectedIdx = state.waypoints.findIndex((w) => (w.name || '') === name);
  fillFormFromAttrs(g);
  highlightListItem(name);
  showInfoPopup(g);
}

// 从列表选中（按 waypoints 下标）
function selectByIndex(idx) {
  const w = state.waypoints[idx];
  if (!w) return;
  state.selectedIdx = idx;
  highlightListItem(w.name || '');
  // 在当前 SVG 中查找对应标点
  const svg = svgEl();
  const target = svg ? findMarkerByName(svg, w.name || '') : null;
  if (target) {
    selectMarker(target);
  } else {
    // 适老版可能裁剪了此标点，直接用 waypoints 数据填充表单
    if (selectedMarkerEl) selectedMarkerEl.classList.remove('selected');
    selectedMarkerEl = null;
    fillFormFromWaypoint(w);
    hideInfoPopup();
  }
}

// 用 SVG data 属性填充编辑表单
function fillFormFromAttrs(g) {
  showMarkerForm();
  dom.mkName.value = g.getAttribute('data-name') || '';
  dom.mkDesc.value = g.getAttribute('data-spot-desc') || '';
  const type = g.getAttribute('data-type') || 'spot';
  dom.mkType.value = Object.prototype.hasOwnProperty.call(TYPE_LABEL, type) ? type : 'spot';
  dom.mkPlan.value = g.getAttribute('data-plan') || '';
}

// 用 waypoint 数据填充编辑表单（无 SVG 标点时）
function fillFormFromWaypoint(w) {
  showMarkerForm();
  dom.mkName.value = w.name || '';
  dom.mkDesc.value = w.spot_desc || w.desc || '';
  const type = w.type || 'spot';
  dom.mkType.value = Object.prototype.hasOwnProperty.call(TYPE_LABEL, type) ? type : 'spot';
  dom.mkPlan.value = w.plan || '';
}

// 编辑字段 → 实时更新 SVG DOM + waypoints 数据
function onEditField(field, val) {
  const idx = state.selectedIdx;
  if (idx < 0 || !state.waypoints[idx]) return;
  const w = state.waypoints[idx];

  // 更新 SVG DOM（若存在选中元素）
  if (selectedMarkerEl) {
    updateMarkerDom(selectedMarkerEl, field, val);
    // 序列化回当前版本字符串
    if (state.version === 'elder') state.svgElder = serializeSvg();
    else state.svgStandard = serializeSvg();
  }

  // 更新 waypoints 中的值（desc 映射到 spot_desc）
  if (field === 'desc') w.spot_desc = val;
  else w[field] = val;

  // 同步 routeData
  if (state.routeData && state.routeData.waypoints && state.routeData.waypoints[idx]) {
    const rwp = state.routeData.waypoints[idx];
    if (field === 'desc') rwp.spot_desc = val;
    else rwp[field] = val;
  }

  // 名称变化需同步列表显示
  if (field === 'name') {
    renderMarkerList();
    highlightListItem(val);
  }
  // 类型变化同步列表颜色点
  if (field === 'type') {
    renderMarkerList();
    highlightListItem(w.name || '');
  }
}

// 把编辑后的值写回 SVG 节点
function updateMarkerDom(g, field, val) {
  const circle = g.querySelector('circle');
  const labelText = g.querySelector('text.marker-label');     // 名称文字
  const typeText = g.querySelector('text:not(.marker-label)'); // 类型缩写（圆点内）
  if (field === 'name') {
    if (labelText) labelText.textContent = val;
    g.setAttribute('data-name', val);
  } else if (field === 'type') {
    if (circle) circle.setAttribute('fill', TYPE_COLOR[val] || '#FF7826');
    if (typeText) typeText.textContent = TYPE_ABBR[val] || '景';
    g.setAttribute('data-type', val);
  } else if (field === 'desc') {
    g.setAttribute('data-spot-desc', val);
  } else if (field === 'plan') {
    g.setAttribute('data-plan', val);
  }
}

// 拖拽标点：mousedown → mousemove → mouseup，更新 transform translate(x,y)
// 未发生位移时视为点击（选中标点）
function startDrag(g, e) {
  const svg = svgEl();
  if (!svg) return;
  e.preventDefault();
  e.stopPropagation();
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  // 屏幕坐标 → SVG 内部坐标
  const toSvg = (ev) => {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    return p.matrixTransform(ctm.inverse());
  };
  const startPos = toSvg(e);
  const base = parseTranslate(g.getAttribute('transform'));
  let dragged = false;
  const move = (ev) => {
    const cur = toSvg(ev);
    const dx = cur.x - startPos.x;
    const dy = cur.y - startPos.y;
    if (!dragged && Math.hypot(dx, dy) > 4) dragged = true;
    if (dragged) {
      const nx = base.x + dx;
      const ny = base.y + dy;
      g.setAttribute('transform', `translate(${nx.toFixed(2)},${ny.toFixed(2)})`);
      // 拖动时同步更新浮层位置
      if (infoPopup) positionPopup(g, infoPopup);
    }
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    if (!dragged) {
      // 未拖动 → 视为点击选中
      selectMarker(g);
    } else {
      // 拖动结束 → 序列化保存当前版本
      if (state.version === 'elder') state.svgElder = serializeSvg();
      else state.svgStandard = serializeSvg();
    }
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

/* ---------- 标点列表 ---------- */
function renderMarkerList() {
  dom.markerList.innerHTML = '';
  if (!state.waypoints.length) {
    dom.markerList.innerHTML = '<div class="ms-empty ms-empty-sm">暂无标点</div>';
    return;
  }
  state.waypoints.forEach((w, idx) => {
    const item = document.createElement('div');
    item.className = 'ms-marker-item';
    item.dataset.idx = String(idx);
    const color = TYPE_COLOR[w.type] || '#FF7826';
    const label = TYPE_LABEL[w.type] || w.type || '标点';
    item.innerHTML =
      `<span class="mk-dot" style="background:${color}"></span>` +
      `<span class="mk-type">${esc(label)}</span>` +
      `<span class="mk-name">${esc(w.name || '未命名')}</span>`;
    item.addEventListener('click', () => selectByIndex(idx));
    dom.markerList.append(item);
  });
}

// 高亮列表中指定名称的项
function highlightListItem(name) {
  dom.markerList.querySelectorAll('.ms-marker-item').forEach((it) => {
    const idx = Number(it.dataset.idx);
    const w = state.waypoints[idx];
    it.classList.toggle('active', !!w && (w.name || '') === name);
  });
}

/* ---------- 编辑表单显隐 ---------- */
function showMarkerForm() {
  dom.markerForm.style.display = '';
  dom.markerEditEmpty.style.display = 'none';
}
function hideMarkerForm() {
  dom.markerForm.style.display = 'none';
  dom.markerEditEmpty.style.display = '';
}

/* ---------- 信息浮层 ---------- */
function showInfoPopup(g) {
  hideInfoPopup();
  const name = g.getAttribute('data-name') || '';
  const type = g.getAttribute('data-type') || 'spot';
  const desc = g.getAttribute('data-spot-desc') || '';
  const plan = g.getAttribute('data-plan') || '';
  const popup = document.createElement('div');
  popup.className = 'ms-info-popup';
  popup.innerHTML =
    `<div class="ms-info-title"><span class="ms-info-dot" style="background:${TYPE_COLOR[type] || '#FF7826'}"></span>${esc(name || '未命名')}</div>` +
    `<div class="ms-info-type">${esc(TYPE_LABEL[type] || type)}</div>` +
    (desc ? `<div class="ms-info-desc">${esc(desc)}</div>` : '') +
    (plan ? `<div class="ms-info-plan">行程：${esc(plan)}</div>` : '');
  dom.canvasWrap.appendChild(popup);
  infoPopup = popup;
  positionPopup(g, popup);
}

// 将浮层定位到标点正上方
function positionPopup(g, popup) {
  const gRect = g.getBoundingClientRect();
  const wrapRect = dom.canvasWrap.getBoundingClientRect();
  const cx = gRect.left + gRect.width / 2 - wrapRect.left;
  const cy = gRect.top - wrapRect.top;
  popup.style.left = cx + 'px';
  popup.style.top = (cy - 10) + 'px';
}

function hideInfoPopup() {
  if (infoPopup) { infoPopup.remove(); infoPopup = null; }
}

/* ---------- 版本切换 ---------- */
function switchVersion(version) {
  if (version === state.version) return;
  state.version = version;
  dom.versionToggle.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.version === version);
  });
  selectedMarkerEl = null;
  state.selectedIdx = -1;
  hideInfoPopup();
  hideMarkerForm();
  if (state.svgStandard || state.svgElder) {
    renderSvg(version);
    bindMarkers();
    setStatus(version === 'elder' ? '已切换到适老版' : '已切换到普通版');
  }
}

/* ---------- 保存（POST /save） ---------- */
async function save() {
  if (!state.routeId) { setStatus('请先选择线路', 'warn'); return; }
  if (!state.routeData) { setStatus('请先点击「一键生成」', 'warn'); return; }
  // 序列化当前画布 SVG 到对应版本
  const svg = svgEl();
  if (svg) {
    if (state.version === 'elder') state.svgElder = serializeSvg();
    else state.svgStandard = serializeSvg();
  }
  if (!state.svgStandard && !state.svgElder) { setStatus('暂无可保存的地图', 'warn'); return; }
  const btn = dom.btnSave;
  btn.disabled = true;
  btn.textContent = '保存中…';
  setStatus('正在保存…');
  try {
    const r = await api('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route_id: state.routeId,
        route_data: state.routeData,
        svg_standard: state.svgStandard,
        svg_elder: state.svgElder,
      }),
    });
    if (!r.ok) { setStatus('保存失败：' + (r.error || ''), 'err'); return; }
    setStatus('保存成功');
    loadSavedList();
  } catch (e) {
    setStatus('请求失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

/* ---------- 发布（POST /publish）—— 与保存分离，不自动发布 ---------- */
async function publish() {
  if (!state.routeId) { setStatus('请先选择线路', 'warn'); return; }
  const dest = state.routeData?.destination;
  const keywordsRaw = (dom.publishKeywords?.value || '').trim();
  const keywords = keywordsRaw ? keywordsRaw.split(/[,，\s]+/).filter(Boolean) : [];
  const product_type = dom.publishProductType?.value || 'wellness';
  const title = state.routeData?.route_name || state.routeId;
  const btn = dom.btnPublish;
  btn.disabled = true;
  btn.textContent = '发布中…';
  setStatus('正在发布…');
  try {
    const r = await api('/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route_id: state.routeId,
        destination: dest,
        keywords,
        product_type,
        title,
        status: 'published',
      }),
    });
    if (!r.ok) {
      const err = r.error || '';
      if (err === 'package_not_found_save_first') {
        setStatus('请先保存线路包再发布', 'err');
      } else {
        setStatus('发布失败：' + err, 'err');
      }
      return;
    }
    setStatus('发布成功');
  } catch (e) {
    setStatus('请求失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '发布';
  }
}

/* ---------- 已保存列表 ---------- */
async function loadSavedList() {
  try {
    const r = await api('/list');
    const packages = r.packages || [];
    if (!packages.length) {
      dom.savedList.innerHTML = '<div class="ms-empty ms-empty-sm">暂无已保存的地图</div>';
      return;
    }
    dom.savedList.innerHTML = '';
    packages.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'ms-saved-item';
      const time = (p.updated_at || p.generated_at || '').slice(0, 16).replace('T', ' ');
      item.innerHTML =
        `<span class="sv-name">${esc(p.route_name || p.route_id)}</span>` +
        `<span class="badge info">${esc(p.waypoint_count ?? '-')} 个标点</span>` +
        `<span class="sv-meta">更新于 ${esc(time)}</span>`;
      const ops = document.createElement('div');
      ops.className = 'ops';
      const btnView = document.createElement('button');
      btnView.className = 'btn sm';
      btnView.textContent = '查看';
      btnView.addEventListener('click', () => viewPackage(p.route_id));
      const btnDel = document.createElement('button');
      btnDel.className = 'btn sm danger';
      btnDel.textContent = '删除';
      btnDel.addEventListener('click', () => deletePackage(p.route_id, p.route_name || p.route_id));
      ops.append(btnView, btnDel);
      item.append(ops);
      dom.savedList.append(item);
    });
  } catch (e) {
    dom.savedList.innerHTML = '<div class="ms-empty ms-empty-sm">加载失败</div>';
  }
}

// 查看已保存的资源包（GET /package/:routeId）
async function viewPackage(routeId) {
  try {
    const r = await api('/package/' + encodeURIComponent(routeId));
    if (!r.ok) { setStatus(r.error || '读取失败', 'err'); return; }
    state.routeId = routeId;
    state.svgStandard = r.svg_standard || '';
    state.svgElder = r.svg_elder || '';
    state.routeData = r.route_data || null;
    state.waypoints = ((r.route_data && r.route_data.waypoints) || []).map((w) => ({ ...w }));
    state.stats = null;
    state.selectedIdx = -1;
    selectedMarkerEl = null;
    // 同步下拉选择
    if (dom.routeSelect) dom.routeSelect.value = routeId;
    renderSvg(state.version);
    bindMarkers();
    renderMarkerList();
    renderStats();
    setStatus('已加载资源包：' + (r.route_data?.route_name || routeId));
    dom.canvasWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    setStatus('读取失败：' + e.message, 'err');
  }
}

// 删除已保存的资源包（DELETE /package/:routeId）
async function deletePackage(routeId, name) {
  if (!confirm('删除资源包「' + (name || routeId) + '」？')) return;
  try {
    const r = await api('/package/' + encodeURIComponent(routeId), { method: 'DELETE' });
    if (!r.ok) { setStatus('删除失败：' + (r.error || ''), 'err'); return; }
    setStatus('已删除');
    loadSavedList();
  } catch (e) {
    setStatus('删除失败：' + e.message, 'err');
  }
}

/* ---------- 数据源状态面板 ---------- */
function renderStats() {
  const s = state.stats;
  if (!s) {
    dom.stats.innerHTML =
      statItem('', 'POI 覆盖', '–') +
      statItem('', 'Tavily 增强', '–') +
      statItem('', '折线点数', '–') +
      statItem('', '简体中文', '–');
    return;
  }
  const total = state.waypoints.length || 1;
  const poiOk = s.poi_count > 0;
  const tavilyOk = s.tavily_count > 0;
  const lineOk = (s.polyline_points ?? 0) > 0;
  dom.stats.innerHTML =
    statItem(poiOk ? '✓' : '⚠', 'POI 覆盖', `${s.poi_count ?? 0}/${total}`, poiOk) +
    statItem(tavilyOk ? '✓' : '⚠', 'Tavily 增强', `${s.tavily_count ?? 0}/${total}`, tavilyOk) +
    statItem(lineOk ? '✓' : '⚠', '折线点数', String(s.polyline_points ?? 0), lineOk) +
    statItem('✓', '简体中文', '已转换', true);
}

// 生成单个状态项 HTML
function statItem(icon, label, value, ok) {
  const cls = ok === undefined ? '' : ok ? ' ok' : ' warn';
  return `<div class="ms-stat${cls}"><span class="ms-stat-icon">${icon}</span><span class="ms-stat-label">${esc(label)}</span><b>${esc(value)}</b></div>`;
}

/* ---------- 状态指示 ---------- */
function setStatus(msg, type) {
  dom.status.textContent = msg || '';
  dom.status.className = 'ms-status' + (type ? ' ' + type : '');
}

function showSpinner(show) {
  dom.spinner.style.display = show ? 'inline-block' : 'none';
}

/* ---------- 初始化 ---------- */
/**
 * 初始化地图制作工坊。
 * @param {Element} root 工坊 DOM 所在根节点（admin SPA 的 #view 容器）
 */
export function initMapStudio(root) {
  // 注入样式（若尚未加载）
  if (!document.querySelector('link[data-ms-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/admin/mapstudio.css';
    link.setAttribute('data-ms-css', '');
    document.head.append(link);
  }

  // 缓存 DOM 引用（全部基于传入的 root 查找，不用 document.getElementById）
  const $ = (sel) => root.querySelector(sel);
  Object.assign(dom, {
    routeSelect: $('#ms-route-select'),
    versionToggle: $('#ms-version-toggle'),
    btnGenerate: $('#ms-btn-generate'),
    btnSave: $('#ms-btn-save'),
    btnPublish: $('#ms-btn-publish'),
    publishKeywords: $('#ms-publish-keywords'),
    publishProductType: $('#ms-publish-product-type'),
    status: $('#ms-status'),
    spinner: $('#ms-spinner'),
    canvasWrap: $('#ms-canvas-wrap'),
    canvas: $('#ms-canvas'),
    stats: $('#ms-stats'),
    markerList: $('#ms-marker-list'),
    markerForm: $('#ms-marker-form'),
    markerEditEmpty: $('#ms-marker-edit-empty'),
    mkName: $('#ms-mk-name'),
    mkDesc: $('#ms-mk-desc'),
    mkType: $('#ms-mk-type'),
    mkPlan: $('#ms-mk-plan'),
    savedList: $('#ms-saved-list'),
    savedRefresh: $('#ms-saved-refresh'),
  });

  if (!dom.canvas) {
    console.warn('[mapstudio] 未找到工坊容器，请先注入 mapstudio.html');
    return;
  }

  // 顶部操作栏事件
  dom.routeSelect.addEventListener('change', () => loadRouteData(dom.routeSelect.value));
  dom.versionToggle.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-version]');
    if (b) switchVersion(b.dataset.version);
  });
  dom.btnGenerate.addEventListener('click', generate);
  dom.btnSave.addEventListener('click', save);
  dom.btnPublish.addEventListener('click', publish);

  // 编辑表单实时更新
  dom.mkName.addEventListener('input', () => onEditField('name', dom.mkName.value));
  dom.mkDesc.addEventListener('input', () => onEditField('desc', dom.mkDesc.value));
  dom.mkType.addEventListener('change', () => onEditField('type', dom.mkType.value));
  dom.mkPlan.addEventListener('input', () => onEditField('plan', dom.mkPlan.value));

  // 已保存列表刷新
  dom.savedRefresh.addEventListener('click', loadSavedList);

  // 点击画布空白处关闭信息浮层
  dom.canvas.addEventListener('click', (e) => {
    if (!e.target.closest('.marker')) hideInfoPopup();
  });

  // 初始渲染
  renderMarkerList();
  renderStats();
  loadRoutes();
  loadSavedList();
}

export default initMapStudio;
