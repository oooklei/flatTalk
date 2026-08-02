import test from 'node:test';
import assert from 'node:assert/strict';

import { fillTemplateSlots } from '../src/core/model-service.js';

test('mock model fills diet_card fields without HTML', async () => {
  const result = await fillTemplateSlots({
    message: '糖尿病老人早餐怎么吃',
    template_id: 'diet_card',
  });

  assert.equal(result.template_id, 'diet_card');
  assert.ok(result.answer_text.includes('早餐'));
  assert.equal(typeof result.data.dateBadge, 'string');
  assert.ok(Array.isArray(result.data.meals));
  assert.equal(result.data.meals[0].mealName, '早餐');
  assert.ok(Array.isArray(result.data.meals[0].foods));
  assert.ok(Array.isArray(result.actions));
  assert.ok(Array.isArray(result.followup_suggestions));
  assert.equal(/<script|<html|javascript:/i.test(JSON.stringify(result)), false);
});

test('mock model fills diet_card data from business table items', async () => {
  const result = await fillTemplateSlots({
    message: '高血压老人晚餐推荐',
    template_id: 'diet_card',
    business_data: { items: ['清蒸鱼', '冬瓜汤', '杂粮饭'] },
  });

  assert.equal(result.data.suitable, '高血压或低盐需求老人');
  assert.equal(result.data.meals[0].mealName, '晚餐');
  assert.deepEqual(
    result.data.meals[0].foods.map((food) => food.foodName),
    ['清蒸鱼', '冬瓜汤', '杂粮饭'],
  );
  assert.ok(result.data.ratioText.includes('控制盐'));
});

test('fallback answer stays structured for unknown template', async () => {
  const result = await fillTemplateSlots({
    message: '社区活动几点开始',
    template_id: 'answer',
  });

  assert.equal(result.template_id, 'health_card');
  assert.equal(result.data.answer_text, result.answer_text);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.followup_suggestions, []);
  assert.deepEqual(result.template_fit_notes, ['fallback_common_answer']);
});

test('mock model strips unsafe text from message and business data', async () => {
  const result = await fillTemplateSlots({
    message: '糖尿病老人早餐<script>alert(1)</script><img src=x onerror=alert(1)>javascript:bad',
    template_id: 'diet_card',
    business_data: {
      items: [
        '&lt;b&gt;燕麦粥&lt;/b&gt;<script>alert(1)</script>',
        '<a onclick=alert(1)>水煮蛋</a>',
        'javascript:黄瓜',
      ],
    },
  });
  const serialized = JSON.stringify(result);

  assert.equal(/<[^>]*>/i.test(serialized), false);
  assert.equal(/&lt;\/?b&gt;/i.test(serialized), false);
  assert.equal(/\bon[a-z]+\s*=/i.test(serialized), false);
  assert.equal(/javascript\s*:/i.test(serialized), false);
  assert.deepEqual(
    result.data.meals[0].foods.map((food) => food.foodName),
    ['燕麦粥alert(1)', '水煮蛋', '黄瓜'],
  );
});

test('travel itinerary keeps duration from product title when product days are missing', async () => {
  const result = await fillTemplateSlots({
    message: '安排这条10天旅居行程',
    template_id: 'travel_itinerary_card',
    default_template_id: 'travel_itinerary_card',
    template_library: [{ id: 'travel_itinerary_card', match: '旅居行程安排' }],
    business_data: {
      jtd: {
        source_status: 'real_data',
        selected_product: {
          product_id: 'jtd_test_10d',
          sku_id: 'sku_test_10d',
          product_name: '防城港10天康养旅居路线',
          destination: '防城港',
          price_label: '约1000元/人',
        },
      },
    },
  });

  assert.equal(result.template_id, 'travel_itinerary_card');
  assert.equal(result.data.days.length, 10);
  assert.equal(result.data.days[0].day, 'D1');
  assert.equal(result.data.days[9].day, 'D10');
  assert.ok(result.data.title.includes('10天'));
});

test('nearby resource static map uses WS key with SK signing', async () => {
  const oldWsKey = process.env.TENCENT_MAP_KEY;
  const oldSk = process.env.TENCENT_MAP_SK;
  try {
    process.env.TENCENT_MAP_KEY = 'TEST-WS-KEY';
    process.env.TENCENT_MAP_SK = 'TEST-SK-SECRET';

    const result = await fillTemplateSlots({
      message: '嘉路康养中心周边地图',
      template_id: 'nearby_map_overview',
      intent_context: { scene_key: 'nearby_resource', intent: 'nearby_resource.all' },
      business_data: {
        jialu_center: { name: '嘉路康养中心', lat: 21.527905, lng: 108.166816 },
        jialu_facilities: [{
          poi_id: 'poi_test_1',
          name: '测试医院',
          address: '测试地址',
          lat: 21.531,
          lng: 108.172,
          distance: 0.8,
          category: '医养',
          amap_type: '医疗',
        }],
      },
    });

    const url = result.data.static_map_url;
    const decoded = decodeURIComponent(url);
    assert.ok(url.includes('key=TEST-WS-KEY'), 'should use WS key');
    assert.ok(url.includes('&sig='), 'should include SK signature');
    assert.ok(decoded.includes('markers=color:blue|size:mid|21.531,108.172'));
  } finally {
    if (oldWsKey === undefined) delete process.env.TENCENT_MAP_KEY;
    else process.env.TENCENT_MAP_KEY = oldWsKey;
    if (oldSk === undefined) delete process.env.TENCENT_MAP_SK;
    else process.env.TENCENT_MAP_SK = oldSk;
  }
});
