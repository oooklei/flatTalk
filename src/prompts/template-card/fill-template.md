请根据以下上下文输出模板卡片 JSON。

【用户问题】{{user_message}}

【意图分类】{{intent_context}}

【当前技能】{{skill_key}}

【指定模板】{{requested_template_id}}

【可用模板库】{{template_library}}

【知识库证据】{{evidence}}

【业务表数据】{{business_data}}

输出格式必须是：

{
  "template_id": "从 template_library 中选择的模板 id",
  "answer_text": "简短回答",
  "data": {},
  "actions": [],
  "followup_suggestions": [],
  "template_fit_notes": []
}

如果【指定模板】不为空且存在于 template_library，必须使用该 template_id。

meal_plan 的 diet_card 模板常用 data 字段：
- dateBadge
- suitable
- totalCal
- salt
- meals: 每项包含 mealName、mealEmoji、mealTotal、foods
- foods: 每项包含 foodIcon、foodName、cal、calNote
- ratioText
- tags
- related
- summary
- nutrition_tips
- risk_warnings

meal_plan 的 weekly_plan 模板常用 data 字段：
- weekly_plan.badge: 例如 "一周计划"
- weekly_plan.title: 一周计划标题
- weekly_plan.summary: 一周总说明
- weekly_plan.items: 必须是数组，长度必须等于 7，分别为周一到周日
- weekly_plan.items[].dayName: 必须是 "周一"、"周二"、"周三"、"周四"、"周五"、"周六"、"周日" 之一
- weekly_plan.items[].summary: 当天提醒
- weekly_plan.items[].meals: 必须是数组，必须包含早餐、午餐、晚餐
- weekly_plan.items[].meals[].mealName: 早餐/午餐/晚餐
- weekly_plan.items[].meals[].foods: 菜品文本，不要返回对象
- weekly_plan.items[].meals[].mealCal: 热量文本
- followup_suggestions: 文本或建议数组
- actions: 文本或动作数组

不要只生成 3 天。只要用户要求一周计划，就必须生成 7 天。
不要把对象数组直接放到一个普通文本字段里；用于模板直接显示的字段必须是字符串，用于重复展示的字段必须是数组。
