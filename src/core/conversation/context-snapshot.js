/**
 * ContextSnapshot — 上下文快照
 *
 * 每轮结束时记录完整上下文，替代 previous_scene 单字段传递。
 */

/**
 * 构建上下文快照
 * @param {Object} turnResult - 编排器返回结果
 * @returns {Object} 快照对象
 */
export function buildSnapshot(turnResult) {
  return {
    scene: turnResult.skill_key || turnResult.scene_key || 'common',
    intent: turnResult.intent || '',
    template_id: turnResult.template_id || '',
    turn_id: turnResult.turn_id || '',
    timestamp: Date.now(),
    semantic_source: turnResult.semantic?.source || '',
    semantic_core_need: turnResult.semantic?.core_need || '',
    semantic_category: turnResult.semantic?.adapted?.category || '',
    semantic_destination: turnResult.semantic?.adapted?.destination || '',
  };
}

/**
 * 从上一轮的 envelope 中提取快照
 * @param {Object} prevTurn - sessionStore.getPreviousTurn() 的返回值
 * @returns {Object|null} 快照对象或 null
 */
export function extractSnapshot(prevTurn) {
  if (!prevTurn) return null;
  const envelope = prevTurn.envelope || prevTurn;
  return envelope.context_snapshot || null;
}

/**
 * 将快照注入到请求 context 中
 * @param {Object} context - 请求 context 对象
 * @param {Object} snapshot - 快照对象
 * @returns {Object} 注入后的 context
 */
export function injectSnapshot(context, snapshot) {
  if (!snapshot) return context;
  return {
    ...context,
    previous_scene: snapshot.scene,
    previous_template: snapshot.template_id,
    previous_intent: snapshot.intent,
    previous_turn_id: snapshot.turn_id,
  };
}
