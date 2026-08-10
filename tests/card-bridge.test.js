import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectBridge } from '../src/core/render/bridge-injector.js';
import { renderTemplateCardResult } from '../src/core/render/template-card-renderer.js';

test('injectBridge appends card-bridge script to HTML', () => {
  const html = '<html><body><div class="card">test</div></body></html>';
  const result = injectBridge(html);
  assert.ok(result.includes('card-bridge-script'), 'should contain bridge script id');
  assert.ok(result.includes('</script>'), 'should have script tag');
});

test('injectBridge handles empty HTML gracefully', () => {
  const result = injectBridge('');
  assert.ok(typeof result === 'string');
});

test('injectBridge does not double-inject if already present', () => {
  const html = '<html><body><script id="card-bridge-script">existing</script></body></html>';
  const result = injectBridge(html);
  const matches = result.match(/card-bridge-script/g);
  assert.equal(matches.length, 1, 'should not double-inject');
});

test('card bridge intercepts tel links and posts phone dial events', () => {
  const html = '<html><body><a href="tel:120">call</a></body></html>';
  const result = injectBridge(html);

  assert.ok(result.includes('flattalk_phone_dial'));
  assert.ok(result.includes('a[href^="tel:"]'));
  assert.ok(result.includes('telHrefToPhone'));
});

test('template-card renderer injects phone bridge into emergency card iframe', () => {
  const result = renderTemplateCardResult({
    templateDir: './src/skills/find_service/templates/html',
    modelResult: {
      template_id: 'service_emergency',
      answer_text: '检测到紧急情况',
      data: {
        matched_keywords: '胸痛、呼吸困难',
        emergency_phone: '',
        emergency_name: '家属',
      },
    },
  });

  assert.ok(result.rendered_html.includes('card-bridge-script'));
  assert.ok(result.rendered_html.includes('flattalk_phone_dial'));
});
