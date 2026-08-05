/**
 * AmbiguityResolver — 消歧追问生成器
 *
 * 当 SceneTransitionManager 返回 AMBIGUOUS 时，
 * 生成一张消歧卡片让用户选择真实意图。
 */

// 场景中文描述（用于消歧卡片）
const SCENE_DESCRIPTIONS = {
  nearby_resource: { icon: '🗺️', label: '查看周边', desc: '搜索嘉路15km生活圈' },
  meal_plan:       { icon: '🍽️', label: '膳食推荐', desc: '一日三餐/一周食谱' },
  travel_route:    { icon: '🧳', label: '旅居规划', desc: '康养旅居路线' },
  find_service:    { icon: '🏥', label: '养老服务', desc: '护工/机构/上门服务' },
  service_quality_eval: { icon: '📊', label: '服务质量', desc: '评价/投诉/整改' },
  health_risk_warning: { icon: '❤️', label: '健康预警', desc: '风险评估/预警报告' },
  dispatch_manage: { icon: '📋', label: '工单调度', desc: '派单/工单/进度' },
  common:          { icon: '💬', label: '政策咨询', desc: '养老补贴/长护险' },
};

/**
 * 生成消歧追问结果
 * @param {Array} candidates - TransitionManager 返回的候选项
 * @param {Object} request - 原始请求
 * @returns {Object} 消歧卡片结果
 */
export function resolveAmbiguity(candidates, request) {
  const options = candidates.map(c => {
    const desc = SCENE_DESCRIPTIONS[c.scene_key] || { icon: '💬', label: c.scene_key, desc: '' };
    return {
      scene_key: c.scene_key,
      skill_key: c.scene_key,
      icon: desc.icon,
      label: desc.label,
      desc: desc.desc,
      confidence: c.confidence,
    };
  });

  return {
    template_id: 'answer',
    skill_key: 'common',
    route_source: 'flatTalk.ambiguity_resolver',
    ambiguity_options: options,
    // 消歧卡片不走完整 LLM 渲染，直接用 answer 模板
    slot_overrides: {
      answer_text: `我不确定您想了解哪个方面，请选择：`,
    },
    // 点击选项后走完整 scene-router（POST /api/chat/message）
    // message = option.label（如"查看周边"）
  };
}
