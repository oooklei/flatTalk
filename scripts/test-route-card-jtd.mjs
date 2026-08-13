import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config'; // 加载 .env，确保 TENCENT_MAP_KEY / TENCENT_MAP_JS_KEY / TENCENT_MAP_SK 可用
import { fillTemplateSlots } from '../src/core/model-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// 金跳动 mock 产品数据（与 jtd-service.js MOCK_PRODUCTS 一致）
const BAMA_PRODUCT = {
  product_id: 'jtd_mock_bama_001',
  sku_id: 'sku_bama_3d',
  product_name: '广西巴马康养旅居三日体验',
  destination: '广西巴马',
  city: '巴马',
  price_amount: 1680,
  price_label: '约1680元/人',
  stock: 6,
  inventory_status: 'available',
  tags: ['慢病友好', '低强度', '医疗可达'],
  handoff_urls: { h5_product_url: 'https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_bama_001' },
  vendor_trace_id: 'mock_vendor_bama_001',
};

const BEIHAI_PRODUCT = {
  product_id: 'jtd_mock_beihai_001',
  sku_id: 'sku_beihai_4d',
  product_name: '广西北海暖冬海滨旅居四日',
  destination: '广西北海',
  city: '北海',
  price_amount: 1380,
  price_label: '约1380元/人',
  stock: 3,
  inventory_status: 'available',
  tags: ['海滨慢行', '家属陪同', '交通便利'],
  handoff_urls: { h5_product_url: 'https://ljutest.jtdcn.cn/mock/sojourn/product/jtd_mock_beihai_001' },
  vendor_trace_id: 'mock_vendor_beihai_001',
};

async function testScenario(name, message, product) {
  const business_data = product ? {
    jtd: {
      products: [product],
      selected_product: product,
      source_status: 'mock_vendor_data',
      ok: true,
    },
  } : {};

  const result = await fillTemplateSlots({
    template_id: 'route_card',
    message,
    business_data,
  });

  console.log(`\n=== ${name} ===`);
  console.log('template_id:', result.template_id);
  console.log('destination:', result.data?.destination);
  console.log('routeTitle:', result.data?.routeTitle);
  console.log('priceLabel:', result.data?.priceLabel);
  console.log('productId:', result.data?.productId);
  console.log('days:', result.data?.days);
  console.log('map_key:', result.data?.map_key ? 'YES (' + String(result.data.map_key).slice(0, 12) + '...)' : 'NO');
  console.log('centerLat:', result.data?.centerLat);
  console.log('centerLng:', result.data?.centerLng);
  console.log('centerName:', result.data?.centerName);
  console.log('static_map_url:', result.data?.static_map_url ? 'YES (' + String(result.data.static_map_url).slice(0, 50) + '...)' : 'NO');
  console.log('markers count:', result.data?.map_markers?.length || 0);
  console.log('answer_text:', result.answer_text);

  return result;
}

function renderHtml(templatePath, data) {
  let html = fs.readFileSync(templatePath, 'utf8');
  // 替换三重花括号（不转义）
  for (const [key, value] of Object.entries(data || {})) {
    const str = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    html = html.replace(new RegExp(`\\{\\{\\{${key}\\}\\}\\}`, 'g'), str);
  }
  // 替换双花括号（转义 HTML）
  for (const [key, value] of Object.entries(data || {})) {
    const str = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), escaped);
  }
  return html;
}

async function main() {
  const scenarios = [
    { name: 'bama', label: '巴马产品', message: '帮我规划巴马旅居路线', product: BAMA_PRODUCT },
    { name: 'beihai', label: '北海产品', message: '帮我规划北海旅居路线', product: BEIHAI_PRODUCT },
    { name: 'fallback', label: '无产品降级', message: '帮我规划旅居路线', product: null },
  ];

  const templatePath = path.join(root, 'src', 'skills', 'travel_route', 'templates', 'html', 'route_card.html');
  const outputDir = path.join(root, 'scripts', 'test-output');
  fs.mkdirSync(outputDir, { recursive: true });

  const results = [];
  for (const scenario of scenarios) {
    const result = await testScenario(scenario.label, scenario.message, scenario.product);
    results.push({ ...scenario, result });

    // 渲染 HTML
    try {
      const html = renderHtml(templatePath, result.data);
      const outFile = path.join(outputDir, `route-card-${scenario.name}.html`);
      fs.writeFileSync(outFile, html);
      console.log(`HTML 已保存: ${outFile}`);
    } catch (e) {
      console.error(`渲染 ${scenario.name} 失败:`, e.message);
    }
  }

  // 生成汇总页面（3个场景并排展示）
  const summaryHtml = generateSummaryPage(results, templatePath);
  const summaryFile = path.join(outputDir, 'route-card-summary.html');
  fs.writeFileSync(summaryFile, summaryHtml);
  console.log(`\n汇总页面: ${summaryFile}`);
}

function generateSummaryPage(results, templatePath) {
  const cards = results.map(({ name, label, result }) => {
    const html = renderHtml(templatePath, result.data);
    return `<section style="margin-bottom:30px"><h2 style="color:#FF7826">${label}</h2><div style="border:1px solid #ddd;border-radius:8px;overflow:hidden">${html}</div></section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>route_card 金跳动产品组合展示测试</title>
<style>
body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
h1 { color: #FF7826; }
</style>
</head>
<body>
<h1>route_card 模板 × 金跳动产品 组合展示测试</h1>
<p>测试场景：巴马产品、北海产品、无产品降级。验证地图数据注入和产品信息填充。</p>
${cards}
</body>
</html>`;
}

main().catch(console.error);
