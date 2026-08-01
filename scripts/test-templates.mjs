/**
 * flatTalk 模板测试脚本
 * 解析语义手册中的"典型用户输入"，逐条发送到系统，记录链路结果
 */
import http from 'node:http';

const PORT = 5298;
const HOST = '127.0.0.1';

// 从语义手册提取的全部测试用例 (模板ID, 期望模板, 用户输入)
const testCases = [
  // common (5个可测，fallback_error系统自动触发跳过)
  { skill: 'common', expected: 'answer', input: '高血压注意什么' },
  { skill: 'common', expected: 'policy_card', input: '养老补贴怎么申请' },
  { skill: 'common', expected: 'policy_list_card', input: '有哪些养老政策' },
  { skill: 'common', expected: 'policy_detail_card', input: '长护险详细解读' },
  { skill: 'common', expected: 'policy_apply_guide_card', input: '长护险怎么申请' },

  // find_service (15个，service_thinking/service_intent/service_emergency特殊触发)
  { skill: 'find_service', expected: 'service_recommend', input: '帮我找个护工' },
  { skill: 'find_service', expected: 'service_card', input: '推荐一项服务' },
  { skill: 'find_service', expected: 'service_detail', input: '这项服务有什么特色' },
  { skill: 'find_service', expected: 'service_catalog', input: '有哪些服务' },
  { skill: 'find_service', expected: 'service_expand', input: '其他优质选择' },
  { skill: 'find_service', expected: 'service_guess_like', input: '猜我喜欢' },
  { skill: 'find_service', expected: 'service_order_form', input: '我要预定' },
  { skill: 'find_service', expected: 'service_order_ticket', input: '下单成功了吗' },
  { skill: 'find_service', expected: 'order_preview', input: '确认订单' },
  { skill: 'find_service', expected: 'order_status', input: '我的订单到哪了' },
  { skill: 'find_service', expected: 'org_profile', input: '这个养老院怎么样' },
  { skill: 'find_service', expected: 'worker_profile', input: '护工资质怎么样' },
  { skill: 'find_service', expected: 'service_emergency', input: '救命' },

  // dispatch_manage (7个)
  { skill: 'dispatch_manage', expected: 'dispatch_list', input: '我的派单' },
  { skill: 'dispatch_manage', expected: 'dispatch_detail', input: '看一下这个派单' },
  { skill: 'dispatch_manage', expected: 'dispatch_status', input: '派单进度' },
  { skill: 'dispatch_manage', expected: 'dispatch_reject', input: '我不接这个单' },
  { skill: 'dispatch_manage', expected: 'dispatch_supplier_action', input: '供应商处理' },
  { skill: 'dispatch_manage', expected: 'dispatch_transfer', input: '转交给别人' },
  { skill: 'dispatch_manage', expected: 'work_order', input: '工单详情' },

  // health_risk_warning (7个)
  { skill: 'health_risk_warning', expected: 'health_warning_card', input: '血压偏高怎么办' },
  { skill: 'health_risk_warning', expected: 'health_report_card', input: '完整健康报告' },
  { skill: 'health_risk_warning', expected: 'risk_assessment_card', input: '风险评估' },
  { skill: 'health_risk_warning', expected: 'risk_warning_card', input: '有什么风险' },
  { skill: 'health_risk_warning', expected: 'dietary_regimen_card', input: '膳食调养建议' },

  // meal_plan (5个)
  { skill: 'meal_plan', expected: 'diet_card', input: '今天吃什么' },
  { skill: 'meal_plan', expected: 'meal_overview_card', input: '每天膳食总览' },
  { skill: 'meal_plan', expected: 'meal_dashboard_card', input: '膳食数据看板' },
  { skill: 'meal_plan', expected: 'meal_timeline_card', input: '按时间看膳食' },
  { skill: 'meal_plan', expected: 'weekly_plan', input: '一周计划' },

  // nearby_resource (12个)
  { skill: 'nearby_resource', expected: 'nearby_map_overview', input: '周边有什么' },
  { skill: 'nearby_resource', expected: 'nearby_map_category', input: '只看民宿' },
  { skill: 'nearby_resource', expected: 'nearby_map_route', input: '一日游路线' },
  { skill: 'nearby_resource', expected: 'nearby_radar', input: '走路能到哪' },
  { skill: 'nearby_resource', expected: 'nearby_list', input: '周边清单' },
  { skill: 'nearby_resource', expected: 'nearby_compare', input: '哪家好对比一下' },
  { skill: 'nearby_resource', expected: 'nearby_recommend', input: '推荐几个' },
  { skill: 'nearby_resource', expected: 'nearby_food_card', input: '附近餐厅吃什么' },
  { skill: 'nearby_resource', expected: 'nearby_spot_card', input: '附近景区海边' },
  { skill: 'nearby_resource', expected: 'nearby_stay_card', input: '住哪里民宿' },
  { skill: 'nearby_resource', expected: 'nearby_wellness', input: '康养配套' },
  { skill: 'nearby_resource', expected: 'nearby_summary', input: '简单告诉我周边情况' },

  // travel_route (9个)
  { skill: 'travel_route', expected: 'travel_need_summary_card', input: '我想去旅居' },
  { skill: 'travel_route', expected: 'travel_itinerary_card', input: '行程安排' },
  { skill: 'travel_route', expected: 'travel_base_card', input: '推荐康养基地' },
  { skill: 'travel_route', expected: 'travel_spot_card', input: '适合老人的景点' },
  { skill: 'travel_route', expected: 'travel_transport_card', input: '怎么去高铁票' },
  { skill: 'travel_route', expected: 'travel_medical_card', input: '附近有医院吗' },
  { skill: 'travel_route', expected: 'travel_weather_risk_card', input: '天气怎么样' },
  { skill: 'travel_route', expected: 'travel_plan_summary_card', input: '方案确认' },
  { skill: 'travel_route', expected: 'route_card', input: '推荐旅居路线' },
];

function sendChat(message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message,
      conversation_id: `test_${Date.now()}`,
      role: 'elder_family',
    });
    const req = http.request(
      { hostname: HOST, port: PORT, path: '/api/chat/message', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ _raw: data.slice(0, 500) }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function extractTemplate(envelope) {
  if (!envelope) return '';
  const card = envelope.card || envelope.data?.card || {};
  return card.template_id || card.templateId || envelope.template_id || envelope.templateId || '';
}

function extractSkill(envelope) {
  if (!envelope) return '';
  return envelope.skill_key || envelope.skillKey || envelope.skill || '';
}

function hasRenderedHtml(envelope) {
  if (!envelope) return false;
  const html = envelope.card?.html || envelope.data?.card?.html || envelope.html || '';
  return html.length > 50;
}

function getRenderSize(envelope) {
  if (!envelope) return 0;
  return (envelope.card?.html || envelope.data?.card?.html || envelope.html || '').length;
}

function getReplyText(envelope) {
  if (!envelope) return '';
  return (envelope.reply_text || envelope.text || envelope.message || '').slice(0, 100);
}

// 执行全部测试
const results = [];
console.log(`开始测试 ${testCases.length} 个用例...\n`);

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const seq = `[${i + 1}/${testCases.length}]`;
  process.stdout.write(`${seq} 测试 "${tc.input}" (期望: ${tc.expected}) ... `);

  const t0 = Date.now();
  let result;
  try {
    const envelope = await sendChat(tc.input);
    const elapsed = Date.now() - t0;
    const actualTemplate = extractTemplate(envelope);
    const actualSkill = extractSkill(envelope);
    const rendered = hasRenderedHtml(envelope);
    const renderSize = getRenderSize(envelope);
    const replyText = getReplyText(envelope);
    const hit = actualTemplate === tc.expected;
    const errorMsg = envelope.error || envelope._raw?.slice(0, 80) || '';

    let missReason = '';
    if (!hit) {
      if (!actualTemplate) missReason = `模型未返回template_id，实际skill=${actualSkill}`;
      else missReason = `路由到${actualTemplate}`;
    }

    let renderReason = '';
    if (!rendered) {
      renderReason = errorMsg || '无HTML输出';
    }

    result = {
      seq: i + 1,
      skill: tc.skill,
      expected: tc.expected,
      input: tc.input,
      actual_template: actualTemplate,
      actual_skill: actualSkill,
      hit: hit ? '是' : '否',
      miss_reason: missReason,
      rendered: rendered ? '是' : '否',
      render_reason: renderReason,
      render_size: renderSize,
      reply_text: replyText,
      elapsed_ms: elapsed,
      error: errorMsg,
    };
    console.log(`${hit ? '✅' : '❌'} ${actualTemplate || '(空)'} ${rendered ? '🖼️' : '⚠️'} ${elapsed}ms`);
  } catch (e) {
    result = {
      seq: i + 1,
      skill: tc.skill,
      expected: tc.expected,
      input: tc.input,
      actual_template: '',
      actual_skill: '',
      hit: '否',
      miss_reason: '请求失败: ' + e.message,
      rendered: '否',
      render_reason: e.message,
      render_size: 0,
      reply_text: '',
      elapsed_ms: Date.now() - t0,
      error: e.message,
    };
    console.log(`💥 ${e.message}`);
  }
  results.push(result);
}

// 输出 JSON 供后续生成 Excel
import fs from 'node:fs';
fs.writeFileSync('docs/template-test-results.json', JSON.stringify(results, null, 2));
console.log(`\n✅ 测试完成！结果已保存到 docs/template-test-results.json`);
console.log(`命中: ${results.filter(r => r.hit === '是').length}/${results.length}`);
console.log(`渲染: ${results.filter(r => r.rendered === '是').length}/${results.length}`);
