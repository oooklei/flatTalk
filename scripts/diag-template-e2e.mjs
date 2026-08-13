// 端到端：fillTemplateSlots → renderTemplateCardResult → 检查残留 Mustache 标签
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

const { fillTemplateSlots } = await import('../src/core/model-service.js');
const { renderTemplateCardResult } = await import('../src/core/render/template-card-renderer.js');

const templateDir = resolve(root, 'src/skills/travel_route/templates/html');

const business_data = {
  primary_city: '广西巴马',
  jtd: {
    provider: 'jintiaodong',
    source_status: 'mock_vendor_data',
    product_domain: 'sojourn_route',
    products: [],
    selected_product: null,
    waypoints: [
      { name: '南宁', lat: 22.8170, lng: 108.3669, day: 'Day1', type: 'arrival', spots: [] },
      { name: '巴马', lat: 24.0544, lng: 107.2583, day: 'Day2', type: 'stay', spots: [
        { name: '百魔洞景区', desc: '巴马著名长寿景点', lat: 24.058, lng: 107.262, source: 'tavily' },
      ], spot_images: [] },
      { name: '北海', lat: 21.4812, lng: 109.1228, day: 'Day3', type: 'departure', spots: [] },
    ],
  },
};

// Step 1: fillTemplateSlots (注意 await！)
console.log('=== Step 1: fillTemplateSlots ===');
const modelResult = await fillTemplateSlots({
  message: '推荐广西巴马三日康养旅居路线',
  template_id: 'sojourn_route',
  business_data,
});

console.log('template_id:', modelResult.template_id);
console.log('answer_text:', String(modelResult.answer_text || '').slice(0, 80));
const dataKeys = Object.keys(modelResult.data || {});
console.log('data 字段数:', dataKeys.length);

// 检查关键字段
const critical = ['routeTitle', 'destination', 'season', 'budgetLevel', 'days', 'suitable', 'bookingStatus', 'summary', 'healthNotice', 'centerLat', 'centerLng', 'waypoints_json', 'spots_json'];
console.log('\n--- 关键字段值 ---');
for (const k of critical) {
  const v = modelResult.data?.[k];
  const info = Array.isArray(v) ? `[${v.length}项]` : (typeof v === 'string' ? `"${v.slice(0, 50)}"` : String(v));
  const empty = v === undefined || v === null || v === '';
  console.log(`  ${k}: ${empty ? '✗ 空' : '✓ ' + info}`);
}

// Step 2: 渲染
console.log('\n=== Step 2: renderTemplateCardResult ===');
const renderResult = renderTemplateCardResult({
  templateDir,
  modelResult,
  actions: modelResult.actions || [],
  followupSuggestions: modelResult.followup_suggestions || [],
});

const html = renderResult.rendered_html || '';
console.log('render_status:', renderResult.render_status);
console.log('HTML 长度:', html.length);

// 提取 srcdoc 内容
const srcdocMatch = html.match(/srcdoc="([\s\S]*?)"><\/iframe>/);
let pageHtml = html;
if (srcdocMatch) {
  pageHtml = srcdocMatch[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

// Step 3: 找残留的 Mustache 标签
console.log('\n=== Step 3: 残留 Mustache 标签 ===');
const tags = [];
const regex = /\{\{[^}]+\}\}/g;
let match;
while ((match = regex.exec(pageHtml)) !== null) {
  tags.push({ tag: match[0], ctx: pageHtml.slice(Math.max(0, match.index - 15), match.index + match[0].length + 15) });
}
if (tags.length === 0) {
  console.log('✓ 没有残留 Mustache 标签');
} else {
  console.log(`✗ 发现 ${tags.length} 个残留标签:`);
  for (const t of tags) console.log(`  ${t.tag}  ...${t.ctx}...`);
}

// 输出
const outDir = resolve(root, 'scripts', 'test-output');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'route-full-test.html'), pageHtml);
console.log('\n已写入 scripts/test-output/route-full-test.html');
