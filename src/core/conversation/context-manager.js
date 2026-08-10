const MAX_TURNS = 10;
const INVALID_STATUSES = ['fallback_mock'];
const INVALID_NOTES = ['fallback_common_answer'];
const INVALID_ANSWER_PREFIX = '抱歉';

export function createContextManager({ sessionStore } = {}) {
  if (!sessionStore) throw new Error('sessionStore is required');

  async function buildHistory(conversationId, agentKey) {
    const session = await sessionStore.getOrCreate(conversationId);

    // 优先取指定 agent 的 turns
    let agent = session.agents?.[agentKey];
    // ★ 如果指定 agent 没有 turns，回退到全局 turns（跨场景追问不脱节）
    if ((!agent || !Array.isArray(agent.turns) || agent.turns.length === 0) && agentKey !== 'common') {
      // 先尝试全局 turns
      const globalTurns = Array.isArray(session.turns) ? session.turns : [];
      if (globalTurns.length > 0) {
        agent = { turns: globalTurns };
      }
    }
    if (!agent || !Array.isArray(agent.turns) || agent.turns.length === 0) return [];

    const validTurns = [];
    for (let i = agent.turns.length - 1; i >= 0 && validTurns.length < MAX_TURNS; i--) {
      const turn = agent.turns[i];
      if (isValidTurn(turn)) validTurns.unshift(turn);
    }

    const messages = [];
    for (const turn of validTurns) {
      const userText = turn.user_message || '';
      if (userText) messages.push({ role: 'user', content: userText });
      const assistantText = turn.envelope?.answer_text || '';
      if (assistantText) messages.push({ role: 'assistant', content: assistantText });
    }
    return messages;
  }

  async function getCommonContext(conversationId) {
    return buildHistory(conversationId, 'common');
  }

  return { buildHistory, getCommonContext };
}

function isValidTurn(turn) {
  const env = turn.envelope || {};
  if (INVALID_STATUSES.includes(env.model_status)) return false;
  const notes = Array.isArray(env.template_fit_notes) ? env.template_fit_notes : [];
  if (notes.some((n) => INVALID_NOTES.includes(n))) return false;
  const answerText = String(env.answer_text || '').trim();
  if (answerText.startsWith(INVALID_ANSWER_PREFIX)) return false;
  if (!turn.user_message && !answerText) return false;
  return true;
}
