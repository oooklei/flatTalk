/**
 * SceneTransitionManager — 场景转换管理器
 *
 * 统一封装场景路由的最终决策，替代 acceptScene 的散乱判断。
 *
 * 决策类型：
 * - ROUTE: 直接路由到 top 场景
 * - AMBIGUOUS: 多场景竞争，需消歧追问
 * - FALLBACK: 全部 reject，走 answer 兜底
 * - CONTINUE: 延续旧场景（含延续词）
 */

export const TRANSITION_TYPE = {
  ROUTE: 'route',
  AMBIGUOUS: 'ambiguous',
  FALLBACK: 'fallback',
  CONTINUE: 'continue',
};

// 延续词列表（触发 CONTINUE）
const CONTINUATION_TERMS = [
  '继续', '换一个', '再来', '下一个', '上一个',
  '再看看', '还有呢', '其他的', '换一种', '再来一个',
  '换个', '再看', '别的', '其他的',
];

// 场景优先级（confidence 相同时按此排序，替代不稳定的 Array.sort）
export const SCENE_PRIORITY = [
  'health_risk_warning',
  'service_quality_eval',
  'find_service',
  'dispatch_manage',
  'nearby_resource',
  'meal_plan',
  'travel_route',
  'common',
];

/** 内联文本匹配（与各规则文件中的 has 一致） */
function has(input, terms) {
  if (!input || !terms) return false;
  const text = typeof input === 'string' ? input : (input.message || input.text || '');
  return terms.some(term => text.includes(term));
}

/**
 * 检测消息中是否包含延续词
 */
function hasContinuationTerm(message) {
  if (!message) return false;
  return CONTINUATION_TERMS.some(term => message.includes(term));
}

/**
 * 对候选项按 confidence 降序 + 场景优先级稳定排序
 */
export function stableSortCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    // 先按 confidence 降序
    const diff = b.confidence - a.confidence;
    if (Math.abs(diff) > 0.001) return diff;
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    // confidence 相同时按场景优先级
    const pa = SCENE_PRIORITY.indexOf(a.scene_key);
    const pb = SCENE_PRIORITY.indexOf(b.scene_key);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });
}

/**
 * 决策场景转换
 * @param {Array} candidates - identifyScene 返回的候选项（已排序）
 * @param {Object} context - { previous_scene, previous_template, message }
 * @returns {Object} { type, scene?, candidates? }
 */
export function decideTransition(candidates, context = {}) {
  if (!candidates || candidates.length === 0) {
    return { type: TRANSITION_TYPE.FALLBACK };
  }

  // 稳定排序
  const sorted = stableSortCandidates(candidates);
  const top = sorted[0];
  const second = sorted[1];

  // case E: 延续词 + 旧场景存在且非 reject
  if (context.previous_scene && hasContinuationTerm(context.message)) {
    const prevScene = sorted.find(c => c.scene_key === context.previous_scene);
    if (prevScene && prevScene.decision !== 'reject') {
      return { type: TRANSITION_TYPE.CONTINUE, scene: prevScene };
    }
  }

  // case A: 明确路由（top accept + routed=true）
  if (top.decision === 'accept' && top.routed) {
    return { type: TRANSITION_TYPE.ROUTE, scene: top };
  }

  // case B: top accept 但 routed=false（margin 不足）+ second 也 accept
  if (top.decision === 'accept' && !top.routed && second && second.decision === 'accept'
      && Math.abs((top.score || 0) - (second.score || 0)) < 1) {
    return {
      type: TRANSITION_TYPE.AMBIGUOUS,
      candidates: sorted.slice(0, 3).filter(c => c.confidence > 0.3),
    };
  }

  // case C: top 是 review → 直接路由（保守策略，避免消歧过度）
  // 只在真正的双 accept margin=0 时才消歧（case B）
  if (top.decision === 'review') {
    return { type: TRANSITION_TYPE.ROUTE, scene: top };
  }

  // case D: 全部 reject → 兜底
  if (top.decision === 'reject') {
    return { type: TRANSITION_TYPE.FALLBACK };
  }

  // 默认：route to top（review 单场景，或 accept 无竞争者）
  return { type: TRANSITION_TYPE.ROUTE, scene: top };
}
