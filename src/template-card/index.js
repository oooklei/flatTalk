// 模板卡片渲染包：给定“模板目录 + 一段 JSON 数据”，返回置换数据后的 HTML 卡片。
// 支持：横向/纵向布局（依原型判断）、数组自动重复渲染、可选分页。
//
// 用法：
//   import { renderCard } from './src/template-card/index.js';
//   const res = renderCard('./cards', jsonData, { pageLimit: 4 });
//   res.pages // string[]，每页是一份完整 HTML 文档
//   res.templateId / res.layout / res.reason
import fs from 'node:fs';
import path from 'node:path';
import { discoverTemplates, describeLibrary } from './discover.js';
import { selectTemplate } from './select.js';
import { renderTemplate, escapeHtml } from './render.js';
import { injectBridge } from '../core/render/bridge-injector.js';

const FOLLOWUP_CSS = `
.tc-followups{box-sizing:border-box;margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.tc-followups-label{font:13px/1.4 system-ui,sans-serif;color:#8a8a8a;margin-right:2px;}
.tc-followup-btn{appearance:none;cursor:pointer;font:13px/1.3 system-ui,sans-serif;padding:8px 14px;border-radius:999px;border:1px solid var(--primary,#2c7be5);background:#fff;color:var(--primary,#2c7be5);transition:.15s;}
.tc-followup-btn:hover{background:var(--primary,#2c7be5);color:#fff;}
`;

const DECK_CSS = (layout) => `
.tc-deck{box-sizing:border-box;}
.tc-deck[data-layout="horizontal"]{display:flex;flex-direction:row;flex-wrap:nowrap;gap:16px;overflow-x:auto;padding:8px 0;}
.tc-deck[data-layout="vertical"]{display:flex;flex-direction:column;gap:16px;}
.tc-card{flex:0 0 auto;}
.tc-pager{margin-top:12px;font:13px/1.4 system-ui,sans-serif;color:#666;}
${FOLLOWUP_CSS}`;

// 把配套追问（manifest.followup_actions）渲染成一组追问按钮。
// 用 data-action 暴露语义值，由宿主页面绑定点击（非卡片内硬编码动作），契合「按钮清除」意图。
function renderFollowups(actions) {
  if (!Array.isArray(actions) || !actions.length) return '';
  const items = actions.map((a) => {
    const label = typeof a === 'string' ? a : (a.label || a.text || '');
    const value = typeof a === 'string' ? a : (a.value || a.action || label);
    return `<button type="button" class="tc-followup-btn" data-action="${escapeHtml(String(value))}">${escapeHtml(String(label))}</button>`;
  }).join('');
  return `<div class="tc-followups"><span class="tc-followups-label">您可以：</span>${items}</div>`;
}

// 归一化输入：兼容 {template_id,data} / {data:{items}} / 纯对象 / 数组
function normalizeInput(json) {
  const templateId = json.template_id || json.template_key || null;
  let data = json.data ?? json;
  if (Array.isArray(data)) data = { items: data };
  const items = Array.isArray(data.items) ? data.items : null;
  return { templateId, data, items };
}

function assembleDocument(css, layout, cardsHtml, pageInfo, followups = '') {
  const deck = `<div class="tc-deck" data-layout="${layout}">${cardsHtml}</div>`;
  const pager = pageInfo
    ? `<div class="tc-pager">第 ${pageInfo.index} / ${pageInfo.total} 页</div>` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}${DECK_CSS(layout)}</style>
</head>
<body>
${deck}
${followups}
${pager}
</body>
</html>`;
}

export function renderCard(dir, json, options = {}) {
  const {
    pageLimit = 0,       // >0 时分页，每页最多 pageLimit 张卡片
    repeatKey = 'items', // 数组数据所在字段（缺省 items）
    fallbackTemplateId = null,
  } = options;

  const templates = discoverTemplates(dir);
  const { templateId, data, items } = normalizeInput(json);

  // 若数据未用 items 包装，但顶层恰好有 repeatKey 字段是数组，也按数组处理
  let list = items;
  if (!list && Array.isArray(data[repeatKey]) && data[repeatKey].length) list = data[repeatKey];

  const { template, reason, score } = selectTemplate(templates, {
    templateId: templateId || fallbackTemplateId,
    data,
  });

  // 待渲染的记录列表：有数组就逐条渲染，否则渲染整段 data 一次
  const records = list && list.length ? list : [data];

  // 渲染每张卡片：原型自带示例数据作为缺省值，再被真实数据覆盖
  const cardsHtml = records
    .map((rec) => `<div class="tc-card">${renderTemplate(template.body, { ...template.defaultData, ...rec })}</div>`)
    .join('\n');

  // 分页
  let pages;
  if (pageLimit > 0 && records.length > pageLimit) {
    const chunks = [];
    for (let i = 0; i < records.length; i += pageLimit) chunks.push(records.slice(i, i + pageLimit));
    pages = chunks.map((_, idx) => {
      const slice = chunks[idx]
        .map((rec) => `<div class="tc-card">${renderTemplate(template.body, { ...template.defaultData, ...rec })}</div>`)
        .join('\n');
      return assembleDocument(template.css, template.layout, slice, { index: idx + 1, total: chunks.length }, renderFollowups(template.followupActions));
    });
  } else {
    pages = [assembleDocument(template.css, template.layout, cardsHtml, null, renderFollowups(template.followupActions))];
  }

  return {
    templateId: template.id,
    layout: template.layout,
    reason,            // 选型依据：model-id / field-coverage / *-fallback
    score,             // 匹配度
    cardCount: records.length,
    pageCount: pages.length,
    pages: pages.map(injectBridge), // string[] 每页一份完整 HTML（注入卡片交互桥接脚本）
    library: describeLibrary(templates), // 可选：把这份清单回传给模型做精确选择
  };
}

// 预览：用模板自带默认数据，把「完整原页」渲染成带数据的成品。
// 保留原型的 <body> 布局与全部 CSS，仅填占位符、删除默认数据脚本块，
// 产物与静态原件像素级可对比。用于人工核对「模板化是否走样」。
export function renderPreview(dir, templateId) {
  const templates = discoverTemplates(dir);
  const template = templates.find((t) => t.id === templateId)
    || templates.find((t) => t.file === templateId)
    || templates[0];
  if (!template) throw new Error(`未找到模板: ${templateId}`);
  const stripJson = (s) => s.replace(
    /<script\b[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi, '');
  // 先删默认数据脚本块，再整体用默认数据渲染，保留原 <body>/<style> 不变
  const fp = renderTemplate(stripJson(template.html), template.defaultData);
  const fu = renderFollowups(template.followupActions);
  if (!fu) return fp;
  return `${fp}\n<style>${FOLLOWUP_CSS}</style>${fu}`;
}

export { discoverTemplates, describeLibrary } from './discover.js';
export { selectTemplate } from './select.js';
export { renderTemplate, collectNames, collectTopLevelNames } from './render.js';
