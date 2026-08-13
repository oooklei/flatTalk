import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplateCardResult } from '../src/core/render/template-card-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, '..', 'src', 'skills', 'meal_plan', 'templates', 'html');

function renderMealOverview(data = {}) {
  return renderTemplate('meal_overview_card', data);
}

function renderTemplate(templateId, data = {}) {
  return renderTemplateCardResult({
    templateDir: TEMPLATE_DIR,
    modelResult: {
      template_id: templateId,
      answer_text: '膳食概览',
      data,
    },
  });
}

const OPTIONAL_RELATED_TEMPLATES = [
  { templateId: 'diet_card', itemClass: 'related-card', valid: { relIcon: '📋', relTitle: '查看完整一周膳食方案' } },
  { templateId: 'meal_dashboard_card', itemClass: 'related-item', valid: { relIcon: '📋', relDesc: '查看完整一周膳食方案' } },
  { templateId: 'meal_overview_card', itemClass: 'related-item', valid: { relIcon: '📋', relTitle: '查看完整一周膳食方案' } },
  { templateId: 'meal_timeline_card', itemClass: 'related-item', valid: { relIcon: '📋', relText: '查看完整一周膳食方案' } },
];

test('meal overview card hides related section when related items are missing', () => {
  const result = renderMealOverview({
    pageTitle: '每日膳食总览',
    summaryTitle: '每日膳食总览与营养比例',
    stats: [],
    meals: [],
    ratios: [],
  });

  assert.equal(result.render_status, 'ok');
  assert.equal(result.card.templateId, 'meal_overview_card');
  assert.equal(result.rendered_html.includes('class=&quot;related-item'), false);
  assert.equal(result.rendered_html.includes('相关膳食建议'), false);
  assert.equal(result.rendered_html.includes('相关建议'), false);
});

test('meal overview card filters blank related items before rendering buttons', () => {
  const result = renderMealOverview({
    pageTitle: '每日膳食总览',
    summaryTitle: '每日膳食总览与营养比例',
    related: [
      { relIcon: '🔗', relText: '' },
      { relIcon: '🔗', relText: '   ' },
      { relIcon: '📋', relTitle: '查看完整一周膳食方案' },
      { relIcon: '🔗', relText: '<br>' },
      { relIcon: '🔗', relText: '&nbsp;' },
    ],
  });

  const renderedItems = result.rendered_html.match(/class=&quot;related-item/g) || [];
  assert.equal(result.render_status, 'ok');
  assert.equal(renderedItems.length, 1);
  assert.ok(result.rendered_html.includes('查看完整一周膳食方案'));
  assert.equal(result.rendered_html.includes('相关建议'), false);
});

test('optional related templates hide related section when model omits related data', () => {
  for (const { templateId, itemClass } of OPTIONAL_RELATED_TEMPLATES) {
    const result = renderTemplate(templateId, {});

    assert.equal(result.render_status, 'ok', templateId);
    assert.equal(result.rendered_html.includes(`class=&quot;${itemClass}`), false, templateId);
    assert.equal(result.rendered_html.includes('相关建议'), false, templateId);
  }
});

test('optional related templates render only non-empty related entries', () => {
  for (const { templateId, itemClass, valid } of OPTIONAL_RELATED_TEMPLATES) {
    const result = renderTemplate(templateId, {
      related: [
        { relIcon: '🔗', relTitle: '', relDesc: '', relText: '' },
        { relIcon: '🔗', relTitle: '<br>', relDesc: '&nbsp;', relText: '   ' },
        valid,
      ],
    });

    const renderedItems = result.rendered_html.match(new RegExp(`class=&quot;${itemClass}`, 'g')) || [];
    assert.equal(result.render_status, 'ok', templateId);
    assert.equal(renderedItems.length, 1, templateId);
    assert.ok(result.rendered_html.includes('查看完整一周膳食方案'), templateId);
    assert.equal(result.rendered_html.includes('相关建议'), false, templateId);
  }
});
