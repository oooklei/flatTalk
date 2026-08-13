// 端到端测试：完整调用链 buildRouteProductContext → LLM 补字段 → fillTemplateSlots → sojourn_route 渲染
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { createJtdTravelService } from '../src/services/travel/jtd-service.js';
import { fillTemplateSlots } from '../src/core/model-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const service = createJtdTravelService({
  mode: process.env.JTD_API_MODE || 'auto',
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

async function main() {
  const scenarios = [
    { name: '0730测试产品_LLM补字段', message: '帮我规划0730测试旅居路线5天4日游' },
    { name: '七洞乡产品_真实地名', message: '帮我规划七洞乡线路产品旅居路线' },
    { name: '自在港湾基地_LLM补字段', message: '帮我预订自在港湾旅居基地' },
    { name: '默认推荐_降级', message: '帮我规划旅居路线' },
  ];

  const outputDir = path.join(root, 'scripts', 'test-output');
  fs.mkdirSync(outputDir, { recursive: true });
  const routeTpl = path.join(root, 'src', 'skills', 'travel_route', 'templates', 'html', 'sojourn_route.html');
  const baseTpl = path.join(root, 'src', 'skills', 'travel_route', 'templates', 'html', 'sojourn_base.html');
  const results = [];

  for (const sc of scenarios) {
    console.log(`\n========== ${sc.name} ==========`);
    console.log('message:', sc.message);
    try {
      // 1. 调用 jtd service 获取产品（含 LLM 补字段）
      const t0 = Date.now();
      const ctx = await service.buildRouteProductContext({ message: sc.message });
      console.log(`[jtd] elapsed=${Date.now() - t0}ms data_source=${ctx.data_source} selected.destination="${ctx.selected_product?.destination}"`);

      // 2. 用 business_data 注入模板
      const result = await fillTemplateSlots({
        template_id: 'sojourn_route',
        message: sc.message,
        business_data: {
          jtd: {
            products: ctx.products,
            selected_product: ctx.selected_product,
            source_status: ctx.source_status,
            ok: true,
            product_domain: ctx.product_domain,
          },
        },
      });

      const tid = result.template_id || 'sojourn_route';
      const tpl = tid === 'sojourn_base' ? baseTpl : routeTpl;
      console.log(`[render] template_id=${tid} destination=${result.data?.destination} waypoints=${result.data?.waypoints?.length || 0} polyline=${result.data?.polyline_path?.length || 0}`);

      const html = renderHtml(tpl, result.data);
      const outFile = path.join(outputDir, `e2e-${sc.name}.html`);
      fs.writeFileSync(outFile, html);
      console.log(`[output] ${outFile}`);
      results.push({ sc, tid, result });
    } catch (e) {
      console.error(`[error] ${sc.name}:`, e.message);
    }
  }

  // 汇总页面
  const cards = results.map(({ sc, tid, result }) => {
    const tpl = tid === 'sojourn_base' ? baseTpl : routeTpl;
    const html = renderHtml(tpl, result.data);
    return `<section style="margin-bottom:30px"><h2 style="color:#FF7826">${sc.name} <span style="font-size:12px;color:#666;font-weight:normal">[${tid}]</span></h2><div style="border:1px solid #ddd;border-radius:8px;overflow:hidden">${html}</div></section>`;
  }).join('\n');

  const summaryHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>端到端测试：金跳动真实接口 × LLM补字段 × sojourn_route 走线</title>
<style>
body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
h1 { color: #FF7826; }
.summary { background: #fff; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; line-height: 1.7; }
.summary b { color: #FF7826; }
</style>
</head>
<body>
<h1>端到端测试：金跳动真实接口 × LLM 补字段 × sojourn_route 走线</h1>
<div class="summary">
<b>数据源链路：</b> 实时金跳动接口 → 本地知识库 → mock<br/>
<b>模板分流：</b> sojourn_route（走线） / sojourn_base（点位）<br/>
<b>地图能力：</b> TMap.Polyline 走线 + MultiMarker 途经点 + SVG 静态降级<br/>
<b>LLM 补字段：</b> destination 为空时用 GLM-4-Flash 推理（产品名→广西地名）<br/>
<b>测试场景：</b> ${results.length} 个
</div>
${cards}
</body>
</html>`;
  const summaryFile = path.join(outputDir, 'e2e-summary.html');
  fs.writeFileSync(summaryFile, summaryHtml);
  console.log(`\n汇总页面: ${summaryFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
