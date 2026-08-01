请根据以下上下文输出模板卡片 JSON。

【用户问题】{{user_message}}

【意图分类】{{intent_context}}

【当前技能】{{skill_key}}

【推荐模板】{{requested_template_id}}

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
  "compact_followups": [],
  "template_fit_notes": []
}

规则：
1. template_id 必须从 template_library 中选择一个真实存在的 id。
2. 【推荐模板】仅供参考。请根据用户问题从 template_library 中选择最匹配的模板。如果用户问题明显匹配其他模板，你可以选择更合适的。
3. data 字段必须按【模板字段说明】中每个模板的 required 和 match 描述来填充。
4. answer_text 是给用户看的简短自然语言摘要，不是字段名列表。
5. 用于模板直接显示的字段必须是字符串，用于重复展示的字段必须是数组。
6. 只输出 JSON，不输出 HTML、Markdown 或解释。
7. compact_followups 是嵌入卡片内部的紧密追问胶囊按钮，每个含 label（按钮文案）、action_key（技能前缀.动作名）、user_prompt（点击后发送的消息）。与 followup_suggestions 互斥去重，适合放入与当前卡片内容直接相关的快捷操作（如"生成一周计划""查看交通""对比路线"）。

特殊模板规则：
- weekly_plan 模板：如果用户要求一周计划，weekly_plan.items 必须是长度为 7 的数组（周一到周日），每天必须包含早餐、午餐、晚餐三餐。
- route_card 模板：itinerary（行程）和 highlights（亮点）必须是数组。
- health_warning_card 模板：symptoms（症状）、suggestions（建议）、lifestyle（生活指导）必须是数组。
