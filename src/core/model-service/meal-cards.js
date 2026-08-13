// 膳食类卡片：周计划、单餐建议、膳食时间线、膳食概览。
// 涵盖 weekly_plan / diet_card / meal_timeline_card / meal_overview_card 四个模板。
// meal_dashboard_card 由 extra-template-fills 提供，本模块不重复实现。

import { sanitizeModelResult, sanitizeText } from './utils.js';
import { elderEntityParams, withEntityParams } from '../conversation/entity-params.js';

function fillWeeklyPlan({ message, business_data }) {
  const condition = inferCondition(message);
  const parsedDays = parseWeekFromText(message);
  const answerText = '\u5df2\u751f\u6210\u4e00\u5468\u4e09\u9910\u8ba1\u5212\u3002';
  const elderParams = elderEntityParams({}, business_data || {});

  // 优先使用用户提供的真实一周数据；未提供时回退示例
  const items = parsedDays.length
    ? normalizeParsedWeek(parsedDays, condition)
    : buildWeeklyPlanItems(condition);

  const compactFollowups = [];

  return sanitizeModelResult({
    template_id: 'weekly_plan',
    answer_text: answerText,
    answer: answerText,
    data: {
      elder_id: elderParams.elder_id || '',
      elder_name: elderParams.elder_name || '',
      weekly_plan: {
        badge: '\u4e00\u5468\u8ba1\u5212',
        title: condition === 'diabetes' ? '\u4e03\u5929\u63a7\u7cd6\u6e05\u6de1\u81b3\u98df\u8ba1\u5212' : '\u4e03\u5929\u6e05\u6de1\u8425\u517b\u81b3\u98df\u8ba1\u5212',
        summary: condition === 'diabetes'
          ? '\u4e3b\u98df\u5b9a\u91cf\uff0c\u642d\u914d\u4f18\u8d28\u86cb\u767d\u548c\u9ad8\u7ea4\u7ef4\u852c\u83dc\uff0c\u51cf\u5c11\u7cbe\u5236\u7cd6\u548c\u751c\u996e\u3002'
          : '\u6bcf\u5929\u4e09\u9910\u6e05\u6de1\u5c11\u6cb9\uff0c\u642d\u914d\u4e3b\u98df\u3001\u86cb\u767d\u8d28\u548c\u852c\u83dc\uff0c\u517c\u987e\u8f6f\u70c2\u6613\u6d88\u5316\u3002',
        suitable: condition === 'diabetes' ? '\u7cd6\u5c3f\u75c5\u6216\u63a7\u7cd6\u9700\u6c42\u957f\u8005' : '\u957f\u8005\u6e05\u6de1\u8425\u517b\u81b3\u98df',
        dailyCal: '\u7ea61200kcal',
        salt: '\u6e05\u6de1\u5c11\u76d0',
        goal: condition === 'diabetes' ? '\u63a7\u7cd6\u7a33\u7cd6' : '\u8425\u517b\u5747\u8861',
        items,
      },
      followup_suggestions: '\u53ef\u7ee7\u7eed\u8c03\u6574\u8f6f\u70c2\u7a0b\u5ea6\u3001\u6162\u75c5\u7981\u5fcc\u6216\u91c7\u8d2d\u6e05\u5355\u3002',
      actions: '\u786e\u8ba4\u8ba1\u5212 / \u751f\u6210\u91c7\u8d2d\u6e05\u5355',
    },
    actions: [],
    followup_suggestions: withEntityParams([
      {
        label: '更软烂一点',
        user_prompt: '请把这份一周膳食计划调整得更软烂易咀嚼',
        action_key: 'meal_plan.adjust_for_condition',
        skill_key: 'meal_plan',
      },
      {
        label: '按控糖调整',
        user_prompt: '请按糖尿病控糖原则调整这份一周膳食计划',
        action_key: 'meal_plan.adjust_for_condition',
        skill_key: 'meal_plan',
        params: { condition: 'diabetes' },
      },
      {
        label: '生成采购清单',
        user_prompt: '请根据这份一周计划生成采购清单',
        action_key: 'meal_plan.shopping_list',
        skill_key: 'meal_plan',
      },
    ], elderParams),
    compact_followups: compactFollowups,
    template_fit_notes: [],
  });
}

// 从消息中解析"周一…周日"结构化一周数据；无则返回 []
function parseWeekFromText(message) {
  const text = String(message || '');
  if (!text) return [];
  const daySplit = text.split(/(?=周[一二三四五六日天]|星期[一二三四五六日天])/);
  const days = [];
  for (const block of daySplit) {
    const dayName = dayNameFromText(block);
    if (!dayName) continue;
    const mealSplit = block.split(/(?=🌅|☀️|🌙|早餐|早饭|午餐|午饭|晚餐|晚饭)/);
    const meals = [];
    for (const seg of mealSplit) {
      const mealName = mealTypeFromText(seg);
      if (!mealName) continue;
      const body = seg.replace(/🌅|☀️|🌙|早餐|早饭|午餐|午饭|晚餐|晚饭/g, '').trim();
      const calMatch = body.match(/约?\s*(\d+)\s*千?卡/);
      const mealCal = calMatch ? `\u7ea6${calMatch[1]}kcal` : '';
      const foods = body.split('\n')
        .map((s) => s.replace(/约?\s*\d+\s*千?卡/g, '').trim())
        .filter(Boolean)[0] || '';
      if (foods) meals.push({ mealName, foods, mealCal });
    }
    if (meals.length) days.push({ dayName, meals });
  }
  return days;
}

function dayNameFromText(t) {
  const m = String(t || '').match(/周[一二三四五六日天]|星期[一二三四五六日天]/);
  if (!m) return null;
  const c = m[0].slice(-1);
  return '周' + (c === '天' ? '日' : c);
}

function mealTypeFromText(t) {
  if (/🌅|早/i.test(t)) return '早餐';
  if (/☀️|午/i.test(t)) return '午餐';
  if (/🌙|晚/i.test(t)) return '晚餐';
  return null;
}

// 把解析出的零散日数据对齐成 7 天标准结构（缺失日用示例兜底）
function normalizeParsedWeek(days, condition) {
  const order = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const byName = {};
  for (const d of days) byName[d.dayName] = d;
  const defaults = buildWeeklyPlanItems(condition);
  return order.map((dayName) => {
    const d = byName[dayName];
    if (!d) return defaults.find((x) => x.dayName === dayName);
    const meals = ['早餐', '午餐', '晚餐'].map((mealName) => {
      const m = d.meals.find((x) => x.mealName === mealName);
      return m || { mealName, foods: '\uff08\u672a\u63d0\u4f9b\uff09', mealCal: '' };
    });
    return { dayName, summary: '\u6309\u60a8\u63d0\u4f9b\u7684\u83dc\u54c1\u5b89\u6392\u3002', meals };
  }).filter(Boolean);
}

function buildWeeklyPlanItems(condition, items = []) {
  const preferred = items.length ? items.slice(0, 3).join('\u3001') : condition === 'diabetes' ? '\u71d5\u9ea6\u7ca5\u3001\u6c34\u716e\u86cb\u3001\u6e05\u84b8\u9c7c' : '\u5c0f\u7c73\u7ca5\u3001\u84b8\u86cb\u3001\u65f6\u4ee4\u852c\u83dc';
  const days = [
    ['\u5468\u4e00', '\u71d5\u9ea6\u5c0f\u7c73\u7ca5\u3001\u9e21\u86cb', '\u6742\u7cae\u996d\u3001\u6e05\u84b8\u9c7c\u3001\u9752\u83dc', '\u756a\u8304\u8c46\u8150\u6c64\u3001\u65f6\u852c'],
    ['\u5468\u4e8c', '\u65e0\u7cd6\u8c46\u6d46\u3001\u5168\u9ea6\u9992\u5934', '\u9e21\u80f8\u8089\u7096\u51ac\u74dc\u3001\u7cd9\u7c73\u996d', '\u5357\u74dc\u5c0f\u7c73\u7ca5\u3001\u8c46\u8150\u9752\u83dc'],
    ['\u5468\u4e09', '\u5c0f\u7c73\u7ca5\u3001\u84b8\u86cb', '\u7cd9\u7c73\u996d\u3001\u8c46\u8150\u9752\u83dc', '\u6e05\u84b8\u9c7c\u3001\u6cb9\u9ea6\u83dc'],
    ['\u5468\u56db', '\u71d5\u9ea6\u7ca5\u3001\u51c9\u62cc\u9ec4\u74dc', '\u6742\u7cae\u996d\u3001\u7626\u8089\u7096\u841d\u535c', '\u7d2b\u83dc\u86cb\u82b1\u6c64\u3001\u65f6\u852c'],
    ['\u5468\u4e94', '\u65e0\u7cd6\u8c46\u6d46\u3001\u7389\u7c73', '\u6e05\u84b8\u9c7c\u3001\u897f\u5170\u82b1', '\u8c46\u8150\u6c64\u3001\u9752\u83dc'],
    ['\u5468\u516d', '\u5357\u74dc\u7ca5\u3001\u9e21\u86cb', '\u6742\u7cae\u996d\u3001\u51ac\u74dc\u867e\u4ec1', '\u5c0f\u7c73\u7ca5\u3001\u65f6\u852c'],
    ['\u5468\u65e5', '\u71d5\u9ea6\u7ca5\u3001\u84b8\u86cb', '\u7cd9\u7c73\u996d\u3001\u6e05\u7096\u9e21\u8089', '\u756a\u8304\u8c46\u8150\u6c64\u3001\u9752\u83dc'],
  ];

  return days.map(([dayName, breakfast, lunch, dinner], index) => ({
    dayName,
    dayTotal: '\u7ea6' + (300 + 520 + 430) + 'kcal',
    summary: index === 0 ? '\u53ef\u4f18\u5148\u4f7f\u7528\uff1a' + preferred : '\u4e3b\u98df\u5b9a\u91cf\uff0c\u5c11\u6cb9\u5c11\u76d0\uff0c\u642d\u914d\u4f18\u8d28\u86cb\u767d\u3002',
    meals: [
      { mealName: '\u65e9\u9910', foods: breakfast, mealCal: '\u7ea6300kcal' },
      { mealName: '\u5348\u9910', foods: lunch, mealCal: '\u7ea6520kcal' },
      { mealName: '\u665a\u9910', foods: dinner, mealCal: '\u7ea6430kcal' },
    ],
  }));
}

function fillDietCard({ message, business_data }) {
  const mealType = inferMealType(message);
  const condition = inferCondition(message);
  const elderParams = elderEntityParams({}, business_data || {});
  const items = Array.isArray(business_data?.items)
    ? business_data.items.map((item) => sanitizeText(item)).filter(Boolean)
    : defaultFoods(condition);
  const meals = buildMeals(mealType, items);
  const answerText = buildAnswer(condition, mealType);

  // 不在卡内塞「您可能还想了解 / compact 芯片」：iframe 内无点击绑定，看起来能点实际不能点。
  // 「生成一周计划」只走气泡外追问栏（followup_suggestions）。
  return sanitizeModelResult({
    template_id: 'diet_card',
    answer_text: answerText,
    answer: answerText,
    data: {
      elder_id: elderParams.elder_id || '',
      elder_name: elderParams.elder_name || '',
      dateBadge: mealType === '一日三餐' ? '今日推荐 - 一日三餐' : `今日推荐 - ${mealType}`,
      suitable: buildSuitable(condition),
      totalCal: mealType === '一日三餐' ? '约620kcal' : '约220kcal',
      salt: condition === 'low_salt' ? '每日不超过5g' : '清淡少盐',
      meals,
      ratioText: buildRatioText(condition),
      tags: buildTags(condition),
      related: [],
      hasRelated: false,
      summary: buildSummary(condition, mealType),
      nutrition_tips: buildNutritionTips(condition),
      risk_warnings: buildRiskWarnings(condition),
    },
    actions: [],
    followup_suggestions: withEntityParams([
      {
        label: '生成一周计划',
        user_prompt: '请按这个原则生成一周膳食计划',
        action_key: 'meal_plan.generate_weekly_plan',
        skill_key: 'meal_plan',
      },
      {
        label: '更软烂一点',
        user_prompt: '请把这份膳食建议调整得更软烂易咀嚼',
        action_key: 'meal_plan.adjust_for_condition',
        skill_key: 'meal_plan',
      },
      {
        label: '控糖怎么吃',
        user_prompt: '糖尿病老人一日三餐怎么安排更稳糖',
        action_key: 'meal_plan.daily_diet',
        skill_key: 'meal_plan',
      },
    ], elderParams),
    compact_followups: [],
    template_fit_notes: [],
  });
}

function inferMealType(message) {
  if (/早餐|早饭|breakfast/i.test(message)) return '早餐';
  if (/午餐|午饭|lunch/i.test(message)) return '午餐';
  if (/晚餐|晚饭|dinner/i.test(message)) return '晚餐';
  if (/一周|七天|周计划|weekly/i.test(message)) return '一日三餐';
  return '一日三餐';
}

function inferCondition(message) {
  if (/糖尿病|血糖|控糖|低糖|diabetes/i.test(message)) return 'diabetes';
  if (/高血压|血压|低盐|hypertension|salt/i.test(message)) return 'low_salt';
  if (/吞咽|咀嚼|软烂|soft/i.test(message)) return 'soft_food';
  return 'general';
}

function defaultFoods(condition) {
  if (condition === 'diabetes') return ['燕麦粥', '水煮蛋', '清炒青菜'];
  if (condition === 'low_salt') return ['清蒸鱼', '冬瓜汤', '杂粮饭'];
  if (condition === 'soft_food') return ['南瓜粥', '蒸蛋羹', '软烂青菜'];
  return ['小米粥', '水煮蛋', '时令蔬菜'];
}

function buildMeals(mealType, items) {
  const names = mealType === '一日三餐' ? ['早餐', '午餐', '晚餐'] : [mealType];
  return names.map((name, index) => ({
    mealName: name,
    mealEmoji: mealEmoji(name),
    mealTotal: index === 0 ? '约180kcal' : index === 1 ? '约260kcal' : '约180kcal',
    foods: items.map((item, itemIndex) => ({
      foodIcon: foodIcon(item),
      foodName: item,
      cal: itemIndex === 0 ? '约90kcal' : itemIndex === 1 ? '约70kcal' : '约60kcal',
      calNote: '建议适量',
    })),
  }));
}

function mealEmoji(mealName) {
  if (mealName === '早餐') return '🌤️🥣';
  if (mealName === '午餐') return '☀️🍱';
  if (mealName === '晚餐') return '🌙🍲';
  return '🍽️';
}

function foodIcon(item) {
  if (/蛋/.test(item)) return '🥚';
  if (/鱼/.test(item)) return '🐟';
  if (/粥/.test(item)) return '🥣';
  if (/菜|瓜|南瓜|冬瓜/.test(item)) return '🥬';
  return '🍽️';
}

function buildSuitable(condition) {
  if (condition === 'diabetes') return '糖尿病或控糖需求老人';
  if (condition === 'low_salt') return '高血压或低盐需求老人';
  if (condition === 'soft_food') return '咀嚼吞咽能力较弱老人';
  return '长者清淡营养膳食';
}

function buildRatioText(condition) {
  if (condition === 'diabetes') return '主食定量，优先低 GI 粗杂粮；搭配优质蛋白和膳食纤维，减少精制糖。';
  if (condition === 'low_salt') return '控制盐和高钠调味品，优先蒸煮炖，保证蛋白质和蔬菜摄入。';
  return '碳水、蛋白质和脂肪均衡搭配，口味清淡，少油少盐。';
}

function buildTags(condition) {
  const tags = [];
  if (condition === 'diabetes') tags.push({ tagIcon: '💙', tagLabel: '糖尿病' });
  if (condition === 'low_salt') tags.push({ tagIcon: '❤️', tagLabel: '高血压' });
  if (condition === 'soft_food') tags.push({ tagIcon: '🥣', tagLabel: '软烂易嚼' });
  tags.push({ tagIcon: '🥗', tagLabel: '清淡膳食' });
  return tags;
}

function buildAnswer(condition, mealType) {
  const conditionText = condition === 'diabetes'
    ? '控糖'
    : condition === 'low_salt'
      ? '低盐'
      : condition === 'soft_food'
        ? '软烂易咀嚼'
        : '清淡均衡';
  return `建议${mealType}以${conditionText}、优质蛋白和易消化食物为主，并结合老人当前健康情况控制总量。`;
}

function buildSummary(condition, mealType) {
  return `${buildSuitable(condition)}的${mealType}建议，重点控制油盐糖并保证蛋白质和膳食纤维。`;
}

function buildNutritionTips(condition) {
  const tips = ['主食控制总量', '优先选择粗杂粮', '搭配优质蛋白'];
  if (condition === 'low_salt') tips.push('减少腌制品和重口味调味料');
  if (condition === 'soft_food') tips.push('优先蒸煮炖，避免坚硬和带刺食物');
  return tips;
}

function buildRiskWarnings(condition) {
  if (condition === 'diabetes') return ['如正在使用降糖药，应避免空腹过久'];
  if (condition === 'low_salt') return ['如血压近期波动明显，应同步咨询医生'];
  return ['如出现胸痛、呼吸困难等急症，应优先就医'];
}

function fillMealTimelineCard({ message }) {
  const meals = [
    { mealName: '早餐', mealEmoji: '🌅', mealTime: '07:00', mealTotal: '约320kcal', dotCls: 'dot-breakfast',
      foods: [{ foodName: '小米粥', cal: 120 }, { foodName: '水煮蛋', cal: 70 }, { foodName: '全麦面包', cal: 130 }] },
    { mealName: '午餐', mealEmoji: '☀️', mealTime: '12:00', mealTotal: '约520kcal', dotCls: 'dot-lunch',
      foods: [{ foodName: '杂粮饭', cal: 200 }, { foodName: '清蒸鱼', cal: 180 }, { foodName: '青菜', cal: 140 }] },
    { mealName: '晚餐', mealEmoji: '🌙', mealTime: '18:00', mealTotal: '约430kcal', dotCls: 'dot-dinner',
      foods: [{ foodName: '番茄豆腐汤', cal: 150 }, { foodName: '时蔬', cal: 120 }, { foodName: '燕麦粥', cal: 160 }] },
  ];
  return sanitizeModelResult({
    template_id: 'meal_timeline_card',
    answer_text: '已为老人安排今日饮食时间线',
    data: { bannerTitle: '今日饮食时间线', meals, ratios: [{ label: '碳水', pct: 55 }, { label: '蛋白', pct: 25 }, { label: '脂肪', pct: 20 }] },
    actions: [], followup_suggestions: [],
  });
}

function fillMealOverviewCard({ message }) {
  return sanitizeModelResult({
    template_id: 'meal_overview_card',
    answer_text: '本周膳食概览',
    data: { title: '本周膳食概览', totalCalories: '约8400kcal', avgDaily: '约1200kcal', days: 7, compliance: '90%', related: [], hasRelated: false },
    actions: [], followup_suggestions: [],
  });
}

export {
  fillWeeklyPlan,
  fillDietCard,
  fillMealTimelineCard,
  fillMealOverviewCard,
};
