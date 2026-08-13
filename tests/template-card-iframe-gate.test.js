import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHtmlFallback,
  cardNeedsIframeIsolation,
} from '../src/core/render/template-card-renderer.js';

test('纯展示膳食卡：不因后续 bridge 字样误判进 iframe', () => {
  const page = `<!doctype html><html><head><style>:root{--x:1}</style></head>
<body><div class="meal-card">今日推荐早餐小米粥</div></body></html>`;
  assert.equal(cardNeedsIframeIsolation(page), false);
  const out = buildHtmlFallback(page);
  assert.equal(out.includes('gxy-template-card-frame'), false, 'should inline, not iframe');
  assert.match(out, /今日推荐早餐小米粥/);
  // bridge 仍会注入，但不改变隔离策略
  assert.match(out, /card-bridge-script|__MAP_KEY__/);
});

test('周边地图卡：仍走 iframe，且用 textarea 承载源码而非 srcdoc 属性', () => {
  const page = `<!doctype html><html><body>
<div id="mapCanvas" class="nb-map" data-map-mode="poi"></div>
<script>new TMap.Map(document.getElementById('mapCanvas'), {})</script>
</body></html>`;
  assert.equal(cardNeedsIframeIsolation(page), true);
  const out = buildHtmlFallback(page);
  assert.match(out, /gxy-template-card-frame/);
  assert.match(out, /gxy-card-html-source/);
  assert.equal(/srcdoc\s*=/.test(out), false, 'avoid long srcdoc attribute on mobile');
  assert.match(out, /mapCanvas/);
});

test('已注入 card-bridge 的膳食卡仍内联（不误判 iframe）', () => {
  const page = `<!doctype html><html><body>
<div class="meal-card">今日推荐早餐</div>
<script id="card-bridge-script">
  script.src = 'https://map.qq.com/api/gljs?v=1.exp&key=' + key;
  new TMap.Map(canvas, {});
</script>
</body></html>`;
  assert.equal(cardNeedsIframeIsolation(page), false);
  const out = buildHtmlFallback(page);
  assert.equal(out.includes('gxy-template-card-frame'), false);
  assert.match(out, /今日推荐早餐/);
});

test('仅外链导航 URI（apis.map.qq.com/uri）不算活地图，应内联', () => {
  const page = `<!doctype html><html><body>
<article class="nb-card">美食推荐</article>
<a data-action-type="external_map" href="https://apis.map.qq.com/uri/v1/routeplan?type=walk">导航</a>
<script id="card-bridge-script">script.src='https://map.qq.com/api/gljs'; new TMap.Map();</script>
</body></html>`;
  assert.equal(cardNeedsIframeIsolation(page), false);
  const out = buildHtmlFallback(page);
  assert.equal(out.includes('gxy-template-card-frame'), false);
  assert.match(out, /美食推荐/);
});
