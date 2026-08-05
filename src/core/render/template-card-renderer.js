import fs from 'node:fs';
import path from 'node:path';
import { renderCard, renderTemplate } from '../../template-card/index.js';
import { injectBridge } from './bridge-injector.js';
import { renderCompactFollowups } from '../compact-followups/renderer.js';
import { normalizeActionDisplayItem } from '../actions/action-labels.js';

const COMMON_HTML = path.join(process.cwd(), 'src', 'skills', 'common', 'templates', 'html', 'common');
const ANSWER_HTML = path.join(COMMON_HTML, 'answer.html');
const ERROR_HTML = path.join(COMMON_HTML, 'fallback_error.html');

function readTpl(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

const HTML_TAG_PATTERN = /<[^>]*>/g;
const EVENT_HANDLER_PATTERN = /\bon[a-z]+\s*=/gi;
const SCRIPT_PROTOCOL_PATTERN = /javascript\s*:/gi;
const OPTIONAL_RELATED_TEMPLATE_IDS = new Set([
  'diet_card',
  'meal_dashboard_card',
  'meal_overview_card',
  'meal_timeline_card',
]);

export function renderTemplateCardResult({
  templateDir,
  modelResult = {},
  actions = [],
  followupSuggestions = [],
  compactFollowups = [],
} = {}) {
  const compactFollowupsHtml = renderCompactFollowups(compactFollowups);
  const llmJson = normalizeLlmJson({
    template_id: modelResult.template_id || modelResult.template_key || null,
    answer: modelResult.answer || modelResult.answer_text || '',
    data: modelResult.data || {},
    actions,
    followups: followupSuggestions,
  });
  let card;
  let pageHtml = '';
  try {
    card = renderCard(templateDir, {
      template_id: llmJson.template_id,
      data: buildRenderData(llmJson, compactFollowupsHtml),
    });
    pageHtml = card.pages[0] || '';
    // 兜底：未匹配到具体模板（仅命中通用默认模板）时，使用公共 answer 模板承载正常返回
    if ((card.reason === 'no-match-fallback' || card.reason === 'low-coverage-fallback') && card.templateId !== 'answer') {
      const tpl = readTpl(ANSWER_HTML);
      if (tpl) {
        pageHtml = renderTemplate(tpl, buildRenderData(llmJson, compactFollowupsHtml));
        card = { ...card, templateId: 'answer', reason: 'answer-fallback' };
      }
    }
  } catch (err) {
    // 兜底：渲染异常时使用公共 fallback_error 模板
    const tpl = readTpl(ERROR_HTML);
    const message = String((err && err.message) ? err.message : err);
    pageHtml = tpl
      ? renderTemplate(tpl, { code: 'RENDER_ERROR', title: '渲染失败', message, suggestion: '请查看运行日志或联系管理员。' })
      : `<p style="color:#d9534f">渲染失败：${message}</p>`;
    card = { templateId: 'fallback_error', layout: 'vertical', reason: 'error_fallback', score: 0, cardCount: 1, pageCount: 1, pages: [pageHtml] };
  }
  const renderedHtml = buildHtmlFallback(pageHtml);

  return {
    llm: llmJson,
    card: {
      templateId: card.templateId,
      layout: card.layout,
      reason: card.reason,
      score: card.score,
      cardCount: card.cardCount,
      pageCount: card.pageCount,
      pages: card.pages,
    },
    rendered_html: renderedHtml,
    html_fallback: renderedHtml,
    render_status: card.templateId === 'fallback_error' ? 'error' : 'ok',
  };
}

function normalizeLlmJson({ template_id, answer, data, actions, followups }) {
  return {
    template_id,
    answer: sanitizeText(answer),
    data: sanitizeModelValue(data),
    actions,
    followups,
  };
}

function buildRenderData(llmJson, compactFollowupsHtml = '') {
  const rawData = llmJson.data && typeof llmJson.data === 'object' ? llmJson.data : {};
  const data = normalizeTemplateData(llmJson.template_id, rawData);
  return {
    ...data,
    answer: llmJson.answer,
    answer_text: llmJson.answer,
    actions: formatActionLabels(llmJson.actions),
    followup_suggestions: formatFollowupLabels(llmJson.followups),
    compact_followups: compactFollowupsHtml,
  };
}

function normalizeTemplateData(templateId, rawData) {
  const data = templateId === 'weekly_plan' ? normalizeWeeklyPlanData(rawData) : rawData;
  if (OPTIONAL_RELATED_TEMPLATE_IDS.has(templateId) || Array.isArray(data.related)) {
    return normalizeRelatedData(data);
  }
  return data;
}

function normalizeRelatedData(data) {
  const related = Array.isArray(data.related)
    ? data.related
        .map(normalizeRelatedItem)
        .filter((item) => item.relHasContent)
    : [];
  return {
    ...data,
    related,
    hasRelated: related.length > 0,
  };
}

function normalizeRelatedItem(item) {
  const source = item && typeof item === 'object' ? item : {};
  const rawTitle = firstVisibleText(source.relTitle, source.title, source.label, source.name);
  const rawDesc = firstVisibleText(source.relDesc, source.desc, source.description, source.subtitle);
  const rawText = firstVisibleText(source.relText, source.text, rawTitle, rawDesc);
  const relHasContent = hasVisibleText(rawText) || hasVisibleText(rawTitle) || hasVisibleText(rawDesc);
  return {
    ...source,
    relText: hasVisibleText(rawText) ? toDisplayText(rawText).trim() : '',
    relTitle: hasVisibleText(rawTitle) ? toDisplayText(rawTitle).trim() : '',
    relDesc: hasVisibleText(rawDesc) ? toDisplayText(rawDesc).trim() : '',
    relHasContent,
  };
}

function firstVisibleText(...values) {
  return values.find((value) => hasVisibleText(value)) ?? '';
}

function hasVisibleText(value) {
  return toDisplayText(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(HTML_TAG_PATTERN, '')
    .replace(/&nbsp;|&#160;|&#x[aA]0;/g, ' ')
    .trim().length > 0;
}

function toDisplayText(value) {
  if (value && typeof value === 'object') {
    return String(value.text ?? value.value ?? value.name ?? value.label ?? '');
  }
  return String(value ?? '');
}

function normalizeWeeklyPlanData(data) {
  const weekly = data.weekly_plan && typeof data.weekly_plan === 'object'
    ? { ...data.weekly_plan }
    : {};
  return {
    ...data,
    weekly_plan: {
      badge: weekly.badge || '一周计划',
      title: weekly.title || '七天控糖清淡膳食计划',
      summary: weekly.summary || '每日三餐按控糖、少盐、优质蛋白和软烂易消化原则轮换。',
      suitable: weekly.suitable || '糖尿病或控糖需求长者',
      dailyCal: weekly.dailyCal || '约1200kcal',
      salt: weekly.salt || '每日<5g',
      goal: weekly.goal || '控糖稳糖',
      items: normalizeWeeklyItems(weekly.items || weekly.days || data.items),
    },
  };
}

function normalizeWeeklyItems(items) {
  const source = Array.isArray(items) ? items : [];
  const defaults = defaultWeeklyItems();
  return defaults.map((fallback, index) => {
    const item = source[index] && typeof source[index] === 'object' ? source[index] : {};
    return {
      ...fallback,
      ...item,
      dayName: item.dayName || item.day || fallback.dayName,
      dayTotal: item.dayTotal || item.totalCal || fallback.dayTotal,
      summary: item.summary || item.itemText || fallback.summary,
      meals: normalizeMeals(item.meals, fallback.meals),
    };
  });
}

function normalizeMeals(meals, fallbackMeals) {
  const source = Array.isArray(meals) ? meals : [];
  return fallbackMeals.map((fallback, index) => {
    const meal = source[index] && typeof source[index] === 'object' ? source[index] : {};
    return {
      ...fallback,
      ...meal,
      mealName: meal.mealName || meal.name || fallback.mealName,
      mealEmoji: meal.mealEmoji || fallback.mealEmoji,
      foods: formatFoods(meal.foods || meal.items || fallback.foods),
      mealCal: meal.mealCal || meal.calories || fallback.mealCal,
    };
  });
}

function formatFoods(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') return item.name || item.food || item.title || '';
      return String(item ?? '');
    }).filter(Boolean).join('、');
  }
  if (value && typeof value === 'object') return value.name || value.food || value.title || '';
  return String(value ?? '');
}

function defaultWeeklyItems() {
  return [
    weeklyDay('周一', '约1250kcal', '主食定量，少油少盐。', ['燕麦小米粥、水煮蛋、凉拌黄瓜', '杂粮饭、清蒸鱼、清炒青菜', '番茄豆腐汤、蒸南瓜、白灼虾']),
    weeklyDay('周二', '约1240kcal', '增加豆制品，避免甜饮。', ['无糖豆浆、全麦馒头、蒸蛋羹', '糙米饭、冬瓜鸡肉、清炒菠菜', '南瓜小米粥、清蒸豆腐、凉拌木耳']),
    weeklyDay('周三', '约1230kcal', '搭配优质蛋白和高纤维蔬菜。', ['玉米面粥、煮鸡蛋、拌豆腐丝', '荞麦饭、番茄牛肉、蒜蓉西兰花', '清蒸鲈鱼、油麦菜、紫菜蛋花汤']),
    weeklyDay('周四', '约1250kcal', '减少精制碳水，控制主食总量。', ['燕麦粥、凉拌黄瓜、鹌鹑蛋', '杂粮饭、瘦肉炒胡萝卜、冬瓜汤', '紫菜蛋花汤、蒸红薯、清炒时蔬']),
    weeklyDay('周五', '约1210kcal', '蒸煮为主，少油少盐。', ['无糖豆浆、玉米、蒸蛋', '清蒸鱼、糙米饭、白灼西兰花', '豆腐青菜汤、蒸南瓜、凉拌木耳']),
    weeklyDay('周六', '约1240kcal', '口味清淡，注意细嚼慢咽。', ['南瓜粥、水煮蛋、拌青菜', '杂粮饭、冬瓜虾仁、清炒芹菜', '小米粥、时蔬豆腐、蒸鱼片']),
    weeklyDay('周日', '约1240kcal', '继续稳糖，避免高糖水果和甜点。', ['燕麦粥、蒸蛋、凉拌黄瓜', '糙米饭、清炖鸡肉、清炒油麦菜', '番茄豆腐汤、蒸山药、白灼青菜']),
  ];
}

function weeklyDay(dayName, dayTotal, summary, foods) {
  return {
    dayName,
    dayTotal,
    summary,
    meals: [
      { mealName: '早餐', mealEmoji: '🌅', foods: foods[0], mealCal: '约300kcal' },
      { mealName: '午餐', mealEmoji: '☀️', foods: foods[1], mealCal: '约520kcal' },
      { mealName: '晚餐', mealEmoji: '🌙', foods: foods[2], mealCal: '约420kcal' },
    ],
  };
}

function formatActionLabels(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return '';
  }

  return actions
    .map((action) => normalizeActionDisplayItem(action)?.label || '')
    .filter(Boolean)
    .join(' / ');
}

function formatFollowupLabels(followups) {
  if (!Array.isArray(followups) || followups.length === 0) {
    return '';
  }

  return followups
    .map((followup) => normalizeActionDisplayItem(followup)?.label || '')
    .filter(Boolean)
    .join(' / ');
}

function extractEmbeddedCss(pageHtml = '') {
  const headMatch = String(pageHtml || '').match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return '';
  const blocks = headMatch[1].match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
  return blocks
    .map((block) => block
      .replace(/^<style\b[^>]*>/i, '')
      .replace(/<\/style>$/i, '')
      .trim())
    .filter(Boolean)
    .join('\n');
}

function scopeCssVarsForInline(css = '') {
  // 内联进 mobile 气泡时，把模板 :root 变量挂到回退容器上，避免被宿主 :root 冲掉、也避免嵌套 <style> 解析失败
  return String(css || '').replace(/(^|})\s*:root\s*\{/g, '$1\n.gxy-html-fallback {');
}

function buildHtmlFallback(pageHtml) {
  // 注入自适配高度脚本：iframe 加载后按内容高度撑开，避免高卡片（如 7 天膳食）被固定高度裁切
  const autoHeightScript = `<script>(function(){try{var h=document.documentElement.scrollHeight||document.body.scrollHeight;var f=window.frameElement;if(f&&h){f.style.height=Math.min(h,1500)+'px';}}catch(e){}})();<\/script>`;
  const mapKey = process.env.TENCENT_MAP_JS_KEY || 'KI4BZ-5GGLT-POOXY-LQK77-6XA62-YVFPH';
  const bridgedHtml = injectBridge(pageHtml, { map_key: mapKey });
  const injected = bridgedHtml.replace(/<\/body>/i, `${autoHeightScript}</body>`);
  const finalHtml = injected.includes(autoHeightScript) ? injected : bridgedHtml + autoHeightScript;

  // 地图/走线卡必须 iframe 隔离，保证模板 CSS 变量与 SVG 交互不被宿主页冲掉
  const htmlWithoutAutoHeight = finalHtml.replace(autoHeightScript, '');
  const needsIframe = htmlWithoutAutoHeight.includes('data-map-mode')
    || /class=["'][^"']*\broute-card\b/i.test(htmlWithoutAutoHeight)
    || /class=["'][^"']*\bsvg-map-section\b/i.test(htmlWithoutAutoHeight)
    || /id=["']svgMapContainer["']/i.test(htmlWithoutAutoHeight)
    || /<script[^>]+src=["']https?:\/\/[^"']*map/i.test(htmlWithoutAutoHeight);

  if (needsIframe) {
    return [
      '<article class="gxy-html-fallback" data-renderer="template-card-renderer">',
      '<style>',
      '.gxy-html-fallback{padding:0;background:transparent;border:0;width:100%;max-width:100%;overflow:visible;}',
      '.gxy-template-card-frame{display:block;width:100%;max-width:100%;height:auto;min-height:240px;max-height:1500px;border:0;border-radius:14px;background:#fff;overflow:auto;box-shadow:0 2px 10px rgba(61,58,54,0.06);}',
      '</style>',
      `<iframe class="gxy-template-card-frame" title="template-card" sandbox="allow-scripts allow-same-origin allow-popups" srcdoc="${escapeAttribute(finalHtml)}"></iframe>`,
      '</article>',
    ].join('');
  }

  // 无 script 的纯展示卡片：直接内联渲染（避免 iframe srcdoc 白屏问题）
  const bodyMatch = finalHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1].replace(autoHeightScript, '') : finalHtml;
  const headCss = scopeCssVarsForInline(extractEmbeddedCss(finalHtml));

  return [
    '<article class="gxy-html-fallback" data-renderer="template-card-renderer">',
    '<style>',
    '.gxy-html-fallback{padding:0;background:transparent;border:0;width:100%;max-width:100%;overflow:visible;color:#3D3A36;}',
    '.gxy-html-fallback .tc-card,.gxy-html-fallback .route-card,.gxy-html-fallback .ai-result-card{display:block;width:100%;border-radius:14px;background:#fff;overflow:hidden;}',
    headCss,
    '</style>',
    bodyContent,
    '</article>',
  ].join('');
}

const HTML_SAFE_KEYS = new Set(['static_svg', 'compact_followups', 'rendered_html']);
function sanitizeModelValue(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeModelValue(item, parentKey));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizeModelValue(child, key)]),
    );
  }

  if (typeof value === 'string') {
    if (HTML_SAFE_KEYS.has(parentKey)) return value;
    return sanitizeText(value);
  }

  return value;
}

function sanitizeText(value) {
  return decodeTextEntities(value)
    .replace(HTML_TAG_PATTERN, '')
    .replace(EVENT_HANDLER_PATTERN, '')
    .replace(SCRIPT_PROTOCOL_PATTERN, '')
    .trim();
}

function decodeTextEntities(value) {
  return String(value ?? '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
