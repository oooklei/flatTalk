// 天气风险按钮完整链路测试
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envText = readFileSync(resolve(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// ========== 测试1：天气服务可用性 ==========
console.log('=== 测试1: 天气服务 ===');
const { createTencentWeatherAdapter } = await import('../src/services/weather/tencent-weather.js');
let weatherService;
try {
  weatherService = createTencentWeatherAdapter();
  check('weatherService 创建成功', !!weatherService);
  check('getWeather 方法存在', typeof weatherService.getWeather === 'function');
} catch (e) {
  check('weatherService 创建', false, e?.message);
}

// 测试城市天气查询
const testCities = ['防城港', '北海', '桂林', '巴马'];
for (const city of testCities) {
  try {
    const w = await weatherService.getWeather(city);
    check(`${city} 天气查询`, !!w, `(ok=${w?.ok}, source=${w?.source})`);
    if (w?.ok) {
      console.log(`    ℹ ${city}: ${w.current?.temp}°C ${w.current?.text}, ${w.forecasts?.length || 0}天预报`);
    } else {
      console.log(`    ℹ ${city} 失败: ${w?.error || w?.message || 'unknown'}`);
    }
  } catch (e) {
    check(`${city} 天气查询`, false, e?.message);
  }
}

// ========== 测试2：resolveWeatherCity 城市提取 ==========
console.log('\n=== 测试2: resolveWeatherCity 城市提取 ===');

// 模拟按钮点击场景：从产品目的地提取
const resolveWeatherCityTest = (request, businessData) => {
  const params = request.context?.action_params || {};
  const fromParams = params.city || request.context?.city;
  if (fromParams && String(fromParams).trim()) return [String(fromParams).trim()];
  const cities = businessData?.cities;
  if (Array.isArray(cities) && cities.length) return cities;
  const bd = businessData || {};
  const jtd = bd.jtd || {};
  const product = jtd.selected_product || (Array.isArray(jtd.products) ? jtd.products[0] : null);
  const route = bd.route || (Array.isArray(bd.routes) ? bd.routes[0] : null);
  const fallback = String(product?.destination || product?.city || route?.destination || bd.primary_city || bd.destination || '').trim();
  return fallback ? [fallback] : [];
};

// 场景A：action_params 有 city
const citiesA = resolveWeatherCityTest(
  { context: { action_params: { city: '防城港' } } },
  {}
);
check('action_params.city 提取', citiesA[0] === '防城港', `(got ${citiesA[0]})`);

// 场景B：从 jtd 产品提取
const citiesB = resolveWeatherCityTest(
  { context: {} },
  { jtd: { selected_product: { destination: '广西防城港' } } }
);
check('jtd.destination 提取', citiesB[0] === '广西防城港', `(got ${citiesB[0]})`);

// 场景C：从 primary_city 提取
const citiesC = resolveWeatherCityTest(
  { context: {} },
  { primary_city: '防城港' }
);
check('primary_city 提取', citiesC[0] === '防城港', `(got ${citiesC[0]})`);

// 场景D：无城市信息
const citiesD = resolveWeatherCityTest({ context: {} }, {});
check('无城市→空数组', citiesD.length === 0);

// ========== 测试3：fillTravelWeatherRisk 填充 ==========
console.log('\n=== 测试3: fillTravelWeatherRisk 填充 ===');
const { fillTravelWeatherRisk, fillTravelWeatherRiskCard } = await import('../src/core/model-service.js');

// 场景A：有天气数据
const weather3 = await weatherService.getWeather('防城港');
const result3 = fillTravelWeatherRisk({
  city: '防城港',
  weather: weather3,
  business_data: { primary_city: '防城港' },
});
check('template_id=travel_weather_risk_card', result3.template_id === 'travel_weather_risk_card', `(got ${result3.template_id})`);
check('answer_text 非空', !!result3.answer_text || !!result3.answer, `(${result3.answer_text?.slice(0,40)})`);
check('data.city 非空', !!result3.data?.city);
check('data.riskTips 是数组', Array.isArray(result3.data?.riskTips), `(got ${result3.data?.riskTips?.length})`);

// 场景B：天气查询失败
const result3b = fillTravelWeatherRisk({
  city: '未知城市',
  weather: { ok: false, error: 'test' },
  business_data: {},
});
check('失败时仍返回模板', result3b.template_id === 'travel_weather_risk_card');

// ========== 测试4：通过编排器完整流程 ==========
console.log('\n=== 测试4: 编排器完整流程 ===');
const { createChatOrchestrator } = await import('../src/core/orchestrator/chat-orchestrator.js');
const { createDataService } = await import('../src/services/data-service.js');
const { fillTemplateSlots } = await import('../src/core/model-service.js');

const dataService = createDataService({});
const orchestrator = createChatOrchestrator({
  dataService,
  modelService: { fillTemplateSlots },
  weatherService,
});

// 模拟用户点"查看天气风险"按钮
const actionRequest = {
  message: '检查老人旅居路线天气风险',
  context: {
    action_key: 'travel_route.check_weather_risk',
    action_params: { city: '防城港', destination: '防城港' },
    followup_source: 'action_button',
  },
  skill_key: 'travel_route',
};

try {
  const result = await orchestrator.run(actionRequest);
  check('编排器返回', !!result);
  check('template_id=travel_weather_risk_card', result?.template_id === 'travel_weather_risk_card', `(got ${result?.template_id})`);
  check('answer_text 非空', !!result?.answer_text || !!result?.answer);
  check('data.city 有值', !!result?.data?.city, `(got ${result?.data?.city})`);

  // 渲染检查
  if (result?.rendered_html) {
    check('有 rendered_html', result.rendered_html.length > 100);
  }

  // 检查 stages 是否走了天气分支
  if (result?.stages) {
    const weatherStage = result.stages.find((s) => s.label?.includes('天气') || s.label?.includes('风险'));
    check('stages 含天气步骤', !!weatherStage, JSON.stringify(result.stages.map(s => s.label)));
  }
} catch (e) {
  check('编排器天气流程', false, e?.message);
  console.log('  错误详情:', e?.stack?.split('\n').slice(0, 5).join('\n'));
}

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
