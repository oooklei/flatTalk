import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { renderTemplateCardResult } from '../src/core/render/template-card-renderer.js';

test('weekly_plan rendering with partial LLM data (3 days) should pad to 7 days', () => {
  const templateDir = path.join(process.cwd(), 'src', 'skills', 'meal_plan', 'templates', 'html');

  // 模拟LLM只返回了3天的数据，且周三只有早餐
  const modelResult = {
    template_id: 'weekly_plan',
    answer_text: '已生成一周三餐计划。',
    data: {
      weekly_plan: {
        badge: '一周计划',
        title: '七天控糖清淡膳食计划',
        summary: '每日三餐按控糖、少盐、优质蛋白和软烂易消化原则轮换。',
        items: [
          {
            dayName: '周一',
            summary: '控糖低盐，主食以杂粮为主，搭配优质蛋白',
            meals: [
              { mealName: '早餐', foods: '燕麦粥、水煮蛋、凉拌黄瓜', mealCal: '约350千卡' },
              { mealName: '午餐', foods: '杂粮饭、清蒸鲈鱼、蒜蓉西蓝花、番茄蛋汤', mealCal: '约520千卡' },
              { mealName: '晚餐', foods: '小米粥、蒸南瓜、清炒菠菜', mealCal: '约380千卡' }
            ]
          },
          {
            dayName: '周二',
            summary: '粗细搭配，增加膳食纤维摄入',
            meals: [
              { mealName: '早餐', foods: '全麦馒头、无糖豆浆、蒸蛋羹', mealCal: '约360千卡' },
              { mealName: '午餐', foods: '糙米饭、香菇鸡丝、凉拌木耳、冬瓜汤', mealCal: '约510千卡' },
              { mealName: '晚餐', foods: '杂粮粥、蒸茄子、白灼虾', mealCal: '约390千卡' }
            ]
          },
          {
            dayName: '周三',
            summary: '低GI主食，搭配深海鱼补充优质蛋白',
            meals: [
              { mealName: '早餐', foods: '小米南瓜粥、水煮蛋、拌豆腐丝', mealCal: '约350千卡' }
              // 注意：周三的午餐和晚餐缺失！
            ]
          }
        ]
      }
    }
  };

  const result = renderTemplateCardResult({
    templateDir,
    modelResult,
    actions: [],
    followupSuggestions: []
  });

  // 验证渲染结果
  assert.equal(result.render_status, 'ok', '渲染应该成功');
  assert.ok(result.rendered_html.includes('周一'), '应该包含周一');
  assert.ok(result.rendered_html.includes('周二'), '应该包含周二');
  assert.ok(result.rendered_html.includes('周三'), '应该包含周三');

  // 关键验证：应该补全到7天
  assert.ok(result.rendered_html.includes('周四'), '应该包含周四（补全）');
  assert.ok(result.rendered_html.includes('周五'), '应该包含周五（补全）');
  assert.ok(result.rendered_html.includes('周六'), '应该包含周六（补全）');
  assert.ok(result.rendered_html.includes('周日'), '应该包含周日（补全）');

  // 验证周三应该有完整的早午晚三餐
  const wednesdayLunch = result.rendered_html.match(/周三.*?午餐/s);
  assert.ok(wednesdayLunch, '周三应该包含午餐（补全）');

  console.log('\n✅ 渲染测试通过：即使LLM只返回3天数据，系统也会补全到7天');
  console.log('\n渲染的HTML长度:', result.rendered_html.length);
  console.log('包含的天数:', ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    .filter(day => result.rendered_html.includes(day)).join(', '));
});