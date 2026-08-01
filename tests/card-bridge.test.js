import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectBridge } from '../src/core/render/bridge-injector.js';

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
