const RULES = [
  { category: 'porn', action: 'block', patterns: [/色情/, /淫秽/, /黄色网站/] },
  { category: 'violence', action: 'block', patterns: [/杀人/, /爆炸制作/, /恐怖袭击/] },
  { category: 'political_extremism', action: 'block', patterns: [/颠覆国家/, /分裂国家/] },
  { category: 'self_harm_negativity', action: 'care', patterns: [/不想活/, /自杀/, /结束生命/, /极度抑郁/] },
];

export function runSafetyGate(text = '') {
  const t = String(text || '');
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(t))) {
      return { action: rule.action, category: rule.category, matched: true };
    }
  }
  return { action: 'pass', category: 'clean', matched: false };
}

export function safetyEnvelope(action) {
  if (action === 'block') {
    return {
      template_id: 'safety_refuse',
      skill_key: 'common',
      message: '该问题涉及不当内容，我无法继续讨论。请换一个养老服务相关的问题。',
    };
  }
  if (action === 'care') {
    return {
      template_id: 'safety_care',
      skill_key: 'common',
      message: '听到你现在很难受。请先照顾好自己；如需帮助，可联系身边亲友或当地心理援助热线。我也可以帮你聊聊养老服务、健康或日常安排。',
    };
  }
  return null;
}
