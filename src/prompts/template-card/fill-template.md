请根据以下上下文输出模板卡片 JSON。

【用户问题】{{user_message}}

【意图分类】{{intent_context}}

【当前技能】{{skill_key}}

【指定模板】{{requested_template_id}}

【可用模板库】
{{template_library}}

【模板字段说明】
{{template_fields}}

【知识库证据】
{{evidence}}

【业务表数据】
{{business_data}}

输出格式必须是：

{
  "template_id": "从 template_library 中选择的模板 id",
  "answer_text": "简短自然语言回答",
  "data": {},
  "actions": [],
  "followup_suggestions": [],
  "template_fit_notes": []
}

规则：
1. template_id 必须从 template_library 中选择一个真实存在的 id。
2. 如果【指定模板】不为空且存在于 template_library，必须使用该 template_id。
3. data 字段必须按【模板字段说明】中每个模板的 required 和 match 描述来填充。
4. answer_text 是给用户看的简短自然语言摘要，不是字段名列表。
5. 用于模板直接显示的字段必须是字符串，用于重复展示的字段必须是数组。
6. 只输出 JSON，不输出 HTML、Markdown 或解释。

特殊模板规则：
- weekly_plan 模板：如果用户要求一周计划，weekly_plan.items 必须是长度为 7 的数组（周一到周日），每天必须包含早餐、午餐、晚餐三餐。
- route_card 模板：itinerary（行程）和 highlights（亮点）必须是数组。
- health_warning_card 模板：symptoms（症状）、suggestions（建议）、lifestyle（生活指导）必须是数组。
