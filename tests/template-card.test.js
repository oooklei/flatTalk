import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard } from '../src/template-card/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS = path.join(__dirname, '..', 'examples', 'cards');

test('场景1：模型指定模板，单卡竖向', () => {
  const r = renderCard(CARDS, { template_id: 'health_card', data: { title: 'T', metrics: [{ label: 'a', value: '1' }] } });
  assert.equal(r.templateId, 'health_card');
  assert.equal(r.layout, 'vertical');
  assert.equal(r.reason, 'model-id');
  assert.ok(r.pages[0].includes('王女士') === false); // 用的是传入数据
  assert.ok(r.pages[0].includes('<h3>T</h3>'));
  assert.ok(r.pages[0].includes('data-layout="vertical"'));
});

test('场景2：数组数据自动重复（竖向）', () => {
  const r = renderCard(CARDS, { items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] });
  assert.equal(r.cardCount, 3);
  assert.equal(r.pageCount, 1);
  assert.equal((r.pages[0].match(/<h3>/g) || []).length, 3);
});

test('场景3：横向模板 + 分页', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ time: `${i}`, place: `P${i}`, note: 'x' }));
  const r = renderCard(CARDS, { template_id: 'route_card', items }, { pageLimit: 2 });
  assert.equal(r.layout, 'horizontal');
  assert.equal(r.cardCount, 5);
  assert.equal(r.pageCount, 3);
  assert.ok(r.pages[0].includes('data-layout="horizontal"'));
  assert.ok(r.pages[0].includes('第 1 / 3 页'));
});

test('场景4：未指定模板时字段覆盖率兜底', () => {
  const r = renderCard(CARDS, { data: { title: 'X', metrics: [{ label: 'y', value: 'z' }] } });
  assert.equal(r.templateId, 'health_card'); // 命中 health_card 的 required
  assert.equal(r.reason, 'field-coverage');
});

test('样式不因数据而变化（原型自带示例作为缺省值）', () => {
  const r = renderCard(CARDS, { template_id: 'health_card', data: { title: '仅标题', metrics: [] } });
  // 即使 metrics 为空，卡片结构样式仍在（.card / .metric 样式被内联）
  assert.ok(r.pages[0].includes('.card{'));
  assert.ok(r.pages[0].includes('box-shadow'));
});
