// 真实金跳动接口数据 × route_card 模板组合展示测试
// 用法: node scripts/test-route-card-real.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { createJtdClient } from '../src/services/travel/jtd-client.js';
import { normalizeSearchRecords } from '../src/services/travel/jtd-service.js';
import { fillTemplateSlots } from '../src/core/model-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const client = createJtdClient({
  baseUrl: process.env.JTD_BASE_URL,
  pathPrefix: process.env.JTD_PATH_PREFIX,
  appId: process.env.JTD_AI_APP_ID,
  appSecret: process.env.JTD_AI_APP_SECRET,
  timeoutMs: Number(process.env.JTD_TIMEOUT_MS || 15000),
});

function renderHtml(templatePath, data) {
  let html = fs.readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(data || {})) {
    const str = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    html = html.replace(new RegExp(`\\{\\{\\{${key}\\}\\}\\}`, 'g'), str);
  }
  for (const [key, value] of Object.entries(data || {})) {
    const str = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), escaped);
  }
  return html;
}

async function fetchAllRealProducts() {
  console.log('=== 拉取金跳动真实接口全部产品 ===');
  // 同时拉 sojourn_route 和 sojourn_base
  const [routeRes, baseRes] = await Promise.all([
    client.searchProducts({ tenantId: process.env.JTD_TENANT_ID || '042788', productDomain: 'sojourn_route', product_type: '旅居线路', pageNum: 1, pageSize: 50 }),
    client.searchProducts({ tenantId: process.env.JTD_TENANT_ID || '042788', productDomain: 'sojourn_base', product_type: '旅居基地', pageNum: 1, pageSize: 50 }),
  ]);

  const extract = (res, domain) => {
    // 用 jtd-service 的 normalizeSearchRecords 归一化，确保字段名一致（product_id/price_label/destination 等）
    const records = normalizeSearchRecords(res);
    // 补充 productDomain（归一化函数不保留此字段）
    return records.map((r) => ({ ...r, product_domain: domain }));
  };

  const routes = extract(routeRes, 'sojourn_route');
  const bases = extract(baseRes, 'sojourn_base');
  console.log(`线路产品: ${routes.length} 个，基地产品: ${bases.length} 个`);
  // 打印归一化后的字段，验证 destination 兜底是否生效
  [...routes, ...bases].forEach((p, i) => {
    console.log(`  [${i + 1}] id=${p.product_id} | name=${p.product_name} | dest=${p.destination} | price=${p.price_amount} | domain=${p.product_domain}`);
  });
  return { routes, bases };
}

async function renderScenario(templatePath, outputDir, scenario) {
  const { name, label, message, product, productDomain } = scenario;
  const business_data = product ? {
    jtd: {
      products: [product],
      selected_product: product,
      source_status: 'real_data',
      ok: true,
      product_domain: productDomain,
    },
  } : {};

  const result = await fillTemplateSlots({
    template_id: 'route_card',
    message,
    business_data,
  });

  // 根据返回的 template_id 动态选择模板文件
  const tid = result.template_id || 'route_card';
  const templateFileMap = {
    'sojourn_route': 'sojourn_route.html',
    'sojourn_base': 'sojourn_base.html',
    'route_card': 'route_card.html',
    'travel_base_card': 'travel_base_card.html',
  };
  const templateFile = templateFileMap[tid] || 'sojourn_route.html';
  const actualTemplatePath = path.join(root, 'src', 'skills', 'travel_route', 'templates', 'html', templateFile);

  console.log(`\n=== ${label} ===`);
  console.log('  template_id:', tid);
  console.log('  destination:', result.data?.destination);
  console.log('  routeTitle:', result.data?.routeTitle);
  console.log('  title:', result.data?.title);
  console.log('  priceLabel:', result.data?.priceLabel);
  console.log('  productId:', result.data?.productId);
  console.log('  days:', result.data?.days);
  console.log('  bases count:', result.data?.bases?.length ?? '-');
  console.log('  map_key:', result.data?.map_key ? 'YES' : 'NO');
  console.log('  centerLat/Lng:', result.data?.centerLat, '/', result.data?.centerLng);
  console.log('  centerName:', result.data?.centerName);
  console.log('  static_map_url:', result.data?.static_map_url ? 'YES' : 'NO');

  try {
    const html = renderHtml(actualTemplatePath, result.data);
    const outFile = path.join(outputDir, `route-card-real-${name}.html`);
    fs.writeFileSync(outFile, html);
    console.log('  HTML:', outFile);
  } catch (e) {
    console.error('  渲染失败:', e.message);
  }
  return result;
}

async function main() {
  if (!client.isConfigured()) {
    console.error('[FATAL] JTD client not configured');
    process.exit(1);
  }

  const { routes, bases } = await fetchAllRealProducts();
  const allProducts = [...routes, ...bases];

  const templatePath = path.join(root, 'src', 'skills', 'travel_route', 'templates', 'html', 'route_card.html');
  const outputDir = path.join(root, 'scripts', 'test-output');
  fs.mkdirSync(outputDir, { recursive: true });

  const scenarios = [];
  // 每个真实产品一个场景
  for (const p of allProducts) {
    const pid = (p.product_id || p.productId || p.id || '').toString();
    const pname = p.product_name || p.productName || p.name || '';
    const domain = p.product_domain || p.productDomain || 'sojourn_route';
    scenarios.push({
      name: `${domain}_${pid}`,
      label: `[${domain === 'sojourn_base' ? '基地' : '线路'}] ${pname}`,
      message: `帮我规划${pname}旅居路线`,
      product: p,
      productDomain: domain,
    });
  }
  // 降级场景
  scenarios.push({
    name: 'fallback_no_product',
    label: '[降级] 无产品',
    message: '帮我规划旅居路线',
    product: null,
    productDomain: 'sojourn_route',
  });

  const results = [];
  for (const sc of scenarios) {
    const r = await renderScenario(templatePath, outputDir, sc);
    results.push({ ...sc, result: r });
  }

  // 汇总页面
  const routeTemplate = path.join(root, 'src', 'skills', 'travel_route', 'templates', 'html', 'sojourn_route.html');
  const baseTemplate = path.join(root, 'src', 'skills', 'travel_route', 'templates', 'html', 'sojourn_base.html');
  const cards = results.map(({ name, label, result }) => {
    const tid = result.template_id || 'sojourn_route';
    const tpl = tid === 'sojourn_base' ? baseTemplate : routeTemplate;
    const html = renderHtml(tpl, result.data);
    return `<section style="margin-bottom:30px"><h2 style="color:#FF7826">${label} <span style="font-size:12px;color:#666;font-weight:normal">[${tid}]</span></h2><div style="border:1px solid #ddd;border-radius:8px;overflow:hidden">${html}</div></section>`;
  }).join('\n');

  const summaryHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>route_card × 金跳动真实产品 组合展示测试</title>
<style>
body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
h1 { color: #FF7826; }
.summary { background: #fff; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; line-height: 1.6; }
</style>
</head>
<body>
<h1>route_card × 金跳动真实接口产品 组合展示</h1>
<div class="summary">
数据源：金跳动测试环境 ${process.env.JTD_BASE_URL}<br/>
租户：${process.env.JTD_TENANT_ID || '042788'}<br/>
线路产品：${routes.length} 个 / 基地产品：${bases.length} 个 / 共 ${allProducts.length} 个真实产品 + 1 降级场景
</div>
${cards}
</body>
</html>`;
  const summaryFile = path.join(outputDir, 'route-card-real-summary.html');
  fs.writeFileSync(summaryFile, summaryHtml);
  console.log(`\n汇总页面: ${summaryFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
