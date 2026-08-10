import { createChatOrchestrator } from '../core/orchestrator/chat-orchestrator.js';
import { createSupervisor } from '../core/agents/supervisor.js';
import { isLisGateEnabled } from '../core/lis/lis-gate-hook.js';

const supervisor = createSupervisor();

export async function runLocalSkill(request = {}, options = {}) {
  const message = request.message || request.text || '';
  const context = request.context || {};
  const lisOn = isLisGateEnabled();

  // ★ Supervisor 路由决策（仅当不是 followup / action 时）
  // LIS 开启时：绝不把 keyword force 写入 skill_key（分拣权威在 LIS）。
  if (!context.followup_source && !context.action_key) {
    const route = await supervisor.route({ message, context });
    const explicitSkillKey = request.skill_key || request.skillKey || '';
    if (!lisOn && !explicitSkillKey && shouldForceRoute(route, message, context)) {
      request.skill_key = route.agentKey || '';
    }
    request.context = {
      ...context,
      agent_key: route.agentKey,
      agent_switched: route.switched,
      agent_from: route.from,
      agent_emergency: route.emergency,
      agent_reason: route.reason,
    };
  } else if (context.action_key) {
    const route = await supervisor.route({ message, context });
    if (!lisOn) {
      request.skill_key = request.skill_key || request.skillKey || route.agentKey || '';
    }
    request.context = {
      ...context,
      agent_key: route.agentKey,
      agent_reason: route.reason,
    };
  }

  return createChatOrchestrator(options).run(request);
}

const SCENE_ROUTER_PRIORITY_TERMS = [
  '\u653f\u7b56',
  '\u8865\u8d34',
  '\u957f\u62a4\u9669',
  '\u957f\u671f\u62a4\u7406\u4fdd\u9669',
  '\u6c11\u653f',
  '\u4eba\u793e',
  '\u517b\u8001\u52a9\u624b',
  '\u6842\u5c0f\u517b',
  '\u600e\u4e48\u7528',
  '\u4f7f\u7528\u65b9\u6cd5',
  '\u80fd\u505a\u4ec0\u4e48',
  '\u53ef\u4ee5\u505a\u4ec0\u4e48',
  '\u670d\u52a1\u8d28\u91cf',
  '\u8d28\u91cf\u8bc4\u4f30',
  '\u670d\u52a1\u8bc4\u4ef7',
  '\u6ee1\u610f\u5ea6',
  '\u6295\u8bc9',
  '\u6574\u6539',
  '\u8bc4\u5206',
  '\u7763\u5bfc',
];

function shouldForceRoute(route = {}, message = '', context = {}) {
  if (route.emergency) return true;
  if (context.reenter_chat === true && (route.reason === 'active_agent_keep' || route.reason === 'keyword_match')) return false;
  if (route.reason === 'active_agent_keep') return true;
  if (route.reason === 'keyword_match' && route.agentKey && route.agentKey !== 'common') {
    return !hasSceneRouterPriorityIntent(message);
  }
  if (String(route.reason || '').startsWith('boundary:')) return true;
  return false;
}

function hasSceneRouterPriorityIntent(message = '') {
  const text = String(message || '');
  return SCENE_ROUTER_PRIORITY_TERMS.some((term) => text.includes(term));
}
