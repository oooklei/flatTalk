import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderTemplateCardResult } from '../src/core/render/template-card-renderer.js';

const TEMPLATE_DIR = './src/skills/travel_route/templates/html';
const TEMPLATE_PATH = 'src/skills/travel_route/templates/html/travel_transport_card.html';

test('travel transport card treats business copy as plain text', async () => {
  const source = await readFile(TEMPLATE_PATH, 'utf8');

  assert.equal(source.includes('{{{text|说明}}}'), false);
  assert.equal(source.includes('<b>¥400-600/天</b>'), false);
  assert.equal(source.includes('<b>¥7</b>'), false);
});

test('travel transport card strips real and entity-encoded html tags from model data', () => {
  const result = renderTemplateCardResult({
    templateDir: TEMPLATE_DIR,
    modelResult: {
      template_id: 'travel_transport_card',
      answer_text: '&lt;b&gt;交通建议&lt;/b&gt;',
      data: {
        title: '交通指南',
        intro: '&lt;b&gt;建议优先选择接站&lt;/b&gt;',
        tickets: [],
        charter: {
          icon: '🚐',
          name: '当地包车',
          items: [
            {
              icon: '🚐',
              name: '多人包车',
              text: '当地价约 <b>¥400-600/天</b>（含司机）。景点往返无需换乘。',
            },
            {
              icon: '🚕',
              name: '短途代步',
              text: '市区出租车起步价约 &lt;b&gt;¥7&lt;/b&gt;，基地管家可协助叫车。',
            },
          ],
        },
        tip: '以当地实际报价为准。',
      },
    },
  });
  const html = result.card.pages[0] || '';

  assert.equal(/<b>|<\/b>|&lt;b&gt;|&lt;\/b&gt;/i.test(html), false);
  assert.ok(html.includes('¥400-600/天'));
  assert.ok(html.includes('¥7'));
});
