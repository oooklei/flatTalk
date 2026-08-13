/**
 * 全模板渲染验证测试 — 旅居路线 + 周边资源
 * 通过模拟对话触发每个模板，检测渲染质量
 * 输出HTML测试报告
 */
import http from 'node:http';

const API_HOST = '127.0.0.1';
const API_PORT = 5298;
const API_PATH = '/api/chat/message';

// 测试用例：每个模板一条模拟对话
const TEST_CASES = [
  // === 旅居路线 travel_route ===
  { group: '旅居路线', tpl: 'route_wellness', msg: '帮我规划巴马康养旅居路线', checkKeys: ['routeTitle','destination','康养','static_svg','route-card','hero'] },
  { group: '旅居路线', tpl: 'route_coastal', msg: '规划防城港滨海度假路线', checkKeys: ['routeTitle','destination','滨海','route-card'] },
  { group: '旅居路线', tpl: 'route_culture', msg: '三江侗族民族文化游路线', checkKeys: ['routeTitle','destination','route-card'] },
  { group: '旅居路线', tpl: 'route_ecology', msg: '崇左德天瀑布生态路线', checkKeys: ['routeTitle','destination','route-card'] },
  { group: '旅居路线', tpl: 'route_svg', msg: '推荐一条广西旅居走线', checkKeys: ['routeTitle','route-card'] },
  { group: '旅居路线', tpl: 'sojourn_base', msg: '推荐康养基地', checkKeys: ['title','base','基地'] },
  { group: '旅居路线', tpl: 'travel_availability_card', msg: '检查巴马旅居路线可预订状态', checkKeys: ['availabilityTitle','可订'] },
  { group: '旅居路线', tpl: 'travel_itinerary_card', msg: '查看巴马康养行程安排', checkKeys: ['title','行程','day'] },
  { group: '旅居路线', tpl: 'travel_medical_card', msg: '巴马旅居的医疗保障', checkKeys: ['title','医疗','groups'] },
  { group: '旅居路线', tpl: 'travel_need_summary_card', msg: '总结我的旅居需求', checkKeys: ['title','需求'] },
  { group: '旅居路线', tpl: 'travel_plan_summary_card', msg: '旅居规划预算汇总', checkKeys: ['title','sum-box'] },
  { group: '旅居路线', tpl: 'travel_spot_card', msg: '推荐巴马景点', checkKeys: ['title','景点'] },
  { group: '旅居路线', tpl: 'travel_transport_card', msg: '巴马旅居交通方案', checkKeys: ['title','交通'] },
  { group: '旅居路线', tpl: 'travel_weather_risk_card', msg: '巴马旅居天气风险', checkKeys: ['title','天气','cur'] },

  // === 周边资源 find_service ===
  { group: '周边资源', tpl: 'service_recommend', msg: '推荐养老服务', checkKeys: ['sceneTitle','服务'] },
  { group: '周边资源', tpl: 'service_catalog', msg: '查看养老服务的分类目录', checkKeys: ['sceneTitle','categories'] },
  { group: '周边资源', tpl: 'service_detail', msg: '查看居家上门服务详情', checkKeys: ['name','intro'] },
  { group: '周边资源', tpl: 'org_profile', msg: '查看养老机构信息', checkKeys: ['orgName','机构'] },
  { group: '周边资源', tpl: 'worker_profile', msg: '查看护理人员信息', checkKeys: ['name','certLevel'] },
  { group: '周边资源', tpl: 'order_preview', msg: '预览服务订单', checkKeys: ['orderId','elderName'] },
  { group: '周边资源', tpl: 'order_status', msg: '查看我的订单状态', checkKeys: ['total','orders'] },
  { group: '周边资源', tpl: 'service_order_form', msg: '我要预约上门照护服务', checkKeys: ['service_name','phone'] },
  { group: '周边资源', tpl: 'service_order_ticket', msg: '查看我的下单凭证', checkKeys: ['order_no','status'] },
  { group: '周边资源', tpl: 'service_expand', msg: '更多养老服务推荐', checkKeys: ['name','price'] },
  { group: '周边资源', tpl: 'service_guess_like', msg: '猜我喜欢什么养老服务', checkKeys: ['name','price'] },
  { group: '周边资源', tpl: 'service_trace', msg: '查看服务追溯', checkKeys: ['orderNo','traceNodes'] },
  { group: '周边资源', tpl: 'service_review', msg: '查看服务评价', checkKeys: ['orgName','totalScore'] },
];

function callChatAPI(message, sessionId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message, sessionId });
    const req = http.request({ host: API_HOST, port: API_PORT, path: API_PATH, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(30000, () => { req.destroy(); resolve({}); });
    req.write(body);
    req.end();
  });
}

function checkRender(d, checkKeys) {
  const rh = d.rendered_html || d.html_fallback || '';
  const card = d.card || {};
  const pages = card.pages || [];
  const pageHtml = pages[0] || '';
  const fullHtml = rh + pageHtml;
  const results = {};
  for (const key of checkKeys) {
    results[key] = fullHtml.includes(key) || fullHtml.includes(key.toLowerCase());
  }
  const passCount = Object.values(results).filter(Boolean).length;
  return { passCount, total: checkKeys.length, results, htmlLen: rh.length };
}

async function runTests() {
  console.log(`Starting ${TEST_CASES.length} template render tests...\n`);
  const results = [];
  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    const sid = `tpl-test-${tc.tpl}-${Date.now()}`;
    process.stdout.write(`[${i + 1}/${TEST_CASES.length}] ${tc.tpl} ... `);
    const d = await callChatAPI(tc.msg, sid);
    const tid = d.template_id || d.card?.templateId || '?';
    const check = checkRender(d, tc.checkKeys);
    const hasSvg = (d.rendered_html || '').includes('<svg') && (d.rendered_html || '').includes('viewBox');
    const hasImg = (d.rendered_html || '').includes('<img') || (d.rendered_html || '').includes('data-spot-img');
    const hasTMap = (d.rendered_html || '').includes('TMap') || (d.rendered_html || '').includes('map.qq.com');
    const status = check.passCount >= check.total * 0.5 ? 'PASS' : 'WARN';
    console.log(`${status} tid=${tid} html=${check.htmlLen}B svg=${hasSvg} img=${hasImg} tmap=${hasTMap} keys=${check.passCount}/${check.total}`);
    results.push({ ...tc, actualTid: tid, ...check, hasSvg, hasImg, hasTMap, status, renderedHtml: d.rendered_html || '' });
    await new Promise((r) => setTimeout(r, 500));
  }

  // Generate HTML report
  const html = generateReport(results);
  // Write to stdout for capture
  console.log('\n=== HTML_REPORT_START ===');
  console.log(html);
  console.log('=== HTML_REPORT_END ===');
}

function generateReport(results) {
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const groups = [...new Set(results.map((r) => r.group))];

  let body = '';
  for (const group of groups) {
    body += `<h2>${group}</h2><table class="test-table"><thead><tr><th>模板ID</th><th>实际路由</th><th>状态</th><th>HTML大小</th><th>SVG</th><th>图片</th><th>TMap</th><th>关键字段</th><th>预览</th></tr></thead><tbody>`;
    for (const r of results.filter((r) => r.group === group)) {
      const statusClass = r.status === 'PASS' ? 'pass' : 'warn';
      const preview = r.renderedHtml ? `<button class="preview-btn" onclick="showPreview('${r.tpl}')">查看</button>` : '—';
      const fieldStatus = r.results;
      const fieldHtml = Object.entries(fieldStatus).map(([k, v]) => `<span class="key ${v ? 'pass' : 'fail'}">${k}</span>`).join(' ');
      const previewDiv = r.renderedHtml ? `<div id="preview-${r.tpl}" class="preview-modal" style="display:none"><div class="preview-content"><button onclick="document.getElementById('preview-${r.tpl}').style.display='none'" class="close-btn">x</button><iframe srcdoc="${r.renderedHtml.replace(/"/g, '&quot;').replace(/&/g, '&amp;')}" style="width:100%;height:600px;border:0"></iframe></div></div>` : '';
      body += `<tr class="${statusClass}"><td>${r.tpl}</td><td>${r.actualTid}</td><td class="${statusClass}">${r.status}</td><td>${r.htmlLen}B</td><td>${r.hasSvg ? '✅' : '—'}</td><td>${r.hasImg ? '✅' : '—'}</td><td>${r.hasTMap ? '✅' : '—'}</td><td>${fieldHtml}</td><td>${preview}</td></tr>${previewDiv}`;
    }
    body += '</tbody></table>';
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>模板渲染测试报告</title><style>
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",system-ui,s-serif;margin:20px;background:#f5f5f5;}
  h1{color:#333}h2{color:#FF7826;border-bottom:2px solid #FF7826;padding-bottom:5px;margin-top:30px;}
  .summary{display:flex;gap:20px;margin-bottom:20px;}
  .stat{padding:15px 25px;border-radius:10px;color:#fff;font-size:18px;font-weight:700;}
  .stat.total{background:#2196F3}.stat.pass{background:#4CAF50}.stat.warn{background:#FF9800}
  table{border-collapse:collapse;width:100%;background:#fff;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.1);}
  th{background:#FF7826;color:#fff;padding:10px;text-align:left;font-size:13px;}
  td{padding:8px;border-bottom:1px solid #eee;font-size:13px;}
  tr.pass{background:#f1f8e9}tr.warn{background:#fff8e1}
  .pass{color:#4CAF50;font-weight:700}.fail{color:#f44336;font-weight:700}.warn{color:#FF9800;font-weight:700}
  .key{display:inline-block;padding:2px 6px;margin:1px;border-radius:3px;font-size:11px;}
  .key.pass{background:#c8e6c9}.key.fail{background:#ffcdd2}
  .preview-btn{padding:3px 8px;border:0;border-radius:4px;background:#FF7826;color:#fff;cursor:pointer;font-size:12px;}
  .preview-btn:hover{background:#E65100}
  .preview-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;}
  .preview-content{background:#fff;border-radius:10px;width:90%;max-width:450px;overflow:hidden;position:relative;}
  .close-btn{position:absolute;top:5px;right:10px;background:#f44336;color:#fff;border:0;border-radius:50%;width:24px;height:24px;cursor:pointer;z-index:10;}
  </style></head><body>
  <h1>模板渲染测试报告</h1>
  <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
  <div class="summary">
    <div class="stat total">总计 ${results.length}</div>
    <div class="stat pass">通过 ${passCount}</div>
    <div class="stat warn">警告 ${warnCount}</div>
  </div>
  ${body}
  <script>function showPreview(id){document.getElementById('preview-'+id).style.display='flex';}</script>
  </body></html>`;
}

runTests().catch((e) => { console.error(e); process.exit(1); });
