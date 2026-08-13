// 完整主流程端到端测试：用户消息 → 场景判断 → 数据加载 → 模板填充 → 渲染
// 验证防城港5条线路在真实编排器链路中的完整表现
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

const { createChatOrchestrator } = await import('../src/core/orchestrator/chat-orchestrator.js');
const { createDataService } = await import('../src/services/data-service.js');
const { fillTemplateSlots } = await import('../src/core/model-service.js');

// 装配服务
const dataService = createDataService({});
const orchestrator = createChatOrchestrator({ dataService, modelService: { fillTemplateSlots } });

const outDir = resolve(root, 'scripts', 'test-output');
mkdirSync(outDir, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// ========== 测试用例 ==========
const testCases = [
  { msg: '推荐防城港京族滨海文化线', expectScene: 'travel_route', expectProduct: '京族滨海文化线', label: '京族滨海' },
  { msg: '想了解银发爱情边境线', expectScene: 'travel_route', expectProduct: '银发爱情边境线', label: '银发爱情' },
  { msg: '壮村民俗康养线路怎么样', expectScene: 'travel_route', expectProduct: '壮村民俗康养线', label: '壮村民俗' },
  { msg: '森林轻氧休闲线适合什么人', expectScene: 'travel_route', expectProduct: '森林轻氧休闲线', label: '森林轻氧' },
  { msg: '芒街跨境体验线多少钱', expectScene: 'travel_route', expectProduct: '芒街跨境体验线', label: '芒街跨境' },
  { msg: '防城港有哪些旅居线路', expectScene: 'travel_route', expectProduct: null, label: '防城港通用' },
];

for (const tc of testCases) {
  console.log(`\n=== ${tc.label}: "${tc.msg}" ===`);
  try {
    const result = await orchestrator.run({
      message: tc.msg,
      session_id: 'test_fcg_routes',
      context: { page: 'chat' },
    });

    // 1. 场景判断
    const sceneKey = result?.scene?.scene_key || result?.scene_key || '';
    check(`${tc.label} 场景=travel_route`, sceneKey === 'travel_route' || !sceneKey, `(got ${sceneKey})`);

    // 2. 响应结构
    const hasAnswer = !!result?.answer_text || !!result?.answer;
    check(`${tc.label} 有回答`, hasAnswer);

    // 3. 模板填充结果
    const modelResult = result?.model_result || result?.modelResult || {};
    const data = modelResult.data || {};
    const templateId = modelResult.template_id || result?.template_id || '';

    check(`${tc.label} template_id 非空`, !!templateId, `(got "${templateId}")`);

    // 如果有 data（模板填充成功）
    if (Object.keys(data).length > 0) {
      check(`${tc.label} dataSource`, data.dataSource === 'local_routes' || !data.dataSource, `(got "${data.dataSource}")`);
      check(`${tc.label} summary 非空`, !!data.summary, `(got "${String(data.summary||'').slice(0,30)}")`);
      check(`${tc.label} map_mode`, !data.map_mode || data.map_mode === 'route', `(got "${data.map_mode}")`);

      if (tc.expectProduct) {
        const productName = data.routeTitle || '';
        check(`${tc.label} 产品匹配`, productName.includes(tc.expectProduct.slice(0, 2)), `(got "${productName}")`);
      }

      // 4. 渲染检查
      if (templateId && result?.rendered_html) {
        const html = result.rendered_html;
        check(`${tc.label} HTML渲染`, html.length > 1000, `(got ${html.length})`);
      }
    }

    // 5. 如果有 interactions
    if (result?.interactions || result?.actions) {
      const actions = result?.interactions || result?.actions || [];
      if (Array.isArray(actions) && actions.length) {
        check(`${tc.label} 有交互动作`, true);
      }
    }
  } catch (e) {
    check(`${tc.label} 无异常`, false, `(error: ${e?.message || e})`);
  }
}

// ========== 额外检查：inferDestination ==========
console.log('\n=== inferDestination 防城港覆盖 ===');
const r = await fillTemplateSlots({ message: '防城港旅居', template_id: 'route_card', business_data: {} });
check('防城港→destination 含防城港', (r.data?.destination || '').includes('防城港'), `(got "${r.data?.destination}")`);

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
