// 端到端测试：防城港5条本地线路查询 + 模板渲染
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envText = readFileSync(resolve(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { buildLocalRouteContext, matchLocalRoutes } = await import('../src/services/travel/local-routes.js');
const { fillTemplateSlots } = await import('../src/core/model-service.js');
const { renderTemplateCardResult } = await import('../src/core/render/template-card-renderer.js');

const templateDir = resolve(root, 'src/skills/travel_route/templates/html');
const outDir = resolve(root, 'scripts', 'test-output');
mkdirSync(outDir, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// ========== 测试1: 关键词匹配 ==========
console.log('=== 测试1: 关键词匹配 ===');
const queries = [
  { msg: '京族滨海文化', expectId: 'fcg_route_001' },
  { msg: '银发爱情边境线', expectId: 'fcg_route_002' },
  { msg: '壮村民俗康养', expectId: 'fcg_route_003' },
  { msg: '十万大山森林', expectId: 'fcg_route_004' },
  { msg: '芒街跨境体验', expectId: 'fcg_route_005' },
];
for (const q of queries) {
  const matches = matchLocalRoutes(q.msg, 'sojourn_route');
  check(`${q.msg}→${q.expectId}`, matches[0]?.product_id === q.expectId, `(got ${matches[0]?.product_id})`);
}

// 防城港通用查询返回全部
const allMatches = matchLocalRoutes('防城港旅居线路', 'sojourn_route');
check('防城港通用→5条', allMatches.length === 5, `(got ${allMatches.length})`);

// ========== 测试2: buildLocalRouteContext ==========
console.log('\n=== 测试2: buildLocalRouteContext ===');
const ctx = await buildLocalRouteContext('京族滨海文化线', 'sojourn_route');
check('provider=local_routes', ctx.provider === 'local_routes');
check('source_status=local_kb_cache', ctx.source_status === 'local_kb_cache');
check('data_source=local_routes', ctx.data_source === 'local_routes');
check('selected_product 非空', !!ctx.selected_product);
check('product_name=京族滨海文化线', ctx.selected_product?.product_name === '京族滨海文化线');
check('price_label=398元', ctx.selected_product?.price_label?.includes('398'));
check('waypoints 非空', Array.isArray(ctx.waypoints) && ctx.waypoints.length > 0);
check('itinerary 非空', Array.isArray(ctx.selected_product?.itinerary) && ctx.selected_product.itinerary.length > 0);
check('highlights 非空', Array.isArray(ctx.selected_product?.highlights) && ctx.selected_product.highlights.length > 0);
check('combo_price 有值', !!ctx.combo_price);

// ========== 测试3: fillRouteCard 端到端 ==========
console.log('\n=== 测试3: fillRouteCard 端到端 ===');
for (const route of queries) {
  const business_data = {
    primary_city: '防城港',
    jtd: await buildLocalRouteContext(route.msg, 'sojourn_route'),
  };
  const modelResult = await fillTemplateSlots({
    message: route.msg,
    template_id: 'sojourn_route',
    business_data,
  });
  const d = modelResult.data || {};
  check(`${route.msg} template_id`, modelResult.template_id === 'sojourn_route');
  check(`${route.msg} dataSource`, d.dataSource === 'local_routes');
  check(`${route.msg} summary 有内容`, d.summary?.length > 10, `(got "${d.summary?.slice(0,30)}")`);
  check(`${route.msg} highlights 是数组`, Array.isArray(d.highlights) && d.highlights.length > 0);
  check(`${route.msg} itinerary 有值`, Array.isArray(d.itinerary) && d.itinerary.length > 5, `(got ${d.itinerary?.length})`);
  check(`${route.msg} waypoints_json 有值`, !!d.waypoints_json);
  check(`${route.msg} map_mode=route`, d.map_mode === 'route');
  check(`${route.msg} centerLat 有效`, Number.isFinite(d.centerLat));

  // 渲染检查
  const renderResult = renderTemplateCardResult({ templateDir, modelResult, actions: modelResult.actions || [], followupSuggestions: [] });
  const html = renderResult.rendered_html || '';
  check(`${route.msg} HTML>5KB`, html.length > 5000, `(got ${html.length})`);

  // 提取页面 HTML 检查技术件名
  const srcdocMatch = html.match(/srcdoc="([\s\S]*?)"><\/iframe>/);
  const pageHtml = srcdocMatch ? srcdocMatch[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>') : html;
  const hasLeak = /tavily|金跳动|jintiaodong|mock|厂家联调/i.test(pageHtml);
  check(`${route.msg} 无技术件名残留`, !hasLeak);

  // 检查残留 Mustache
  const mustache = pageHtml.match(/\{\{[^}]+\}\}/g);
  check(`${route.msg} 无残留 Mustache`, !mustache || mustache.length === 0, `(found ${mustache?.length})`);

  // 输出第一条线路的完整 HTML 文件
  if (route.expectId === 'fcg_route_001') {
    writeFileSync(resolve(outDir, `fcg-${route.expectId}.html`), pageHtml);
  }
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
