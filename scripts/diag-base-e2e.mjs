// sojourn_base 端到端：fillTemplateSlots → 渲染 → 检查
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

const business_data = {
  jtd: {
    source_status: 'mock_vendor_data',
    product_domain: 'sojourn_base',
    products: [
      { product_name: '防城港滨海康养中心', destination: '防城港', price_label: '3000元/月起', tags: ['慢病康复', '海滨气候'] },
      { product_name: '北海银滩康养基地', destination: '北海', price_label: '2500元/月起', tags: ['慢病友好', '海滨气候'] },
    ],
  },
};

const modelResult = await fillTemplateSlots({
  message: '推荐康养基地',
  template_id: 'sojourn_base',
  business_data,
});

console.log('=== sojourn_base 端到端 ===');
console.log('template_id:', modelResult.template_id);
console.log('answer_text:', modelResult.answer_text?.slice(0, 60));
console.log('map_mode:', modelResult.data?.map_mode);
console.log('centerLat:', modelResult.data?.centerLat);
console.log('markers_json 有值:', !!modelResult.data?.markers_json);

const templateDir = resolve(root, 'src/skills/travel_route/templates/html');
const renderResult = renderTemplateCardResult({ templateDir, modelResult, actions: [], followupSuggestions: [] });
const html = renderResult.rendered_html || '';
console.log('render_status:', renderResult.render_status);
console.log('HTML 长度:', html.length);

// 检查技术件名残留
const srcdocMatch = html.match(/srcdoc="([\s\S]*?)"><\/iframe>/);
let pageHtml = srcdocMatch ? srcdocMatch[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"') : html;
const hasLeak = /tavily|金跳动|jintiaodong|mock|厂家联调/i.test(pageHtml);
console.log('技术件名残留:', hasLeak ? '✗ 有' : '✓ 无');

const outDir = resolve(root, 'scripts', 'test-output');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'base-full-test.html'), pageHtml);
console.log('已写入 scripts/test-output/base-full-test.html');
