import path from 'node:path';
import { identifyScene, RULE_SETS, executeHealthRiskWarningRuleSet } from './src/core/scene-router/index.js';
import { createKnowledgeDataService } from './src/services/knowledge-data/index.js';
import { fillTemplateSlots } from './src/core/model-service.js';
import { discoverTemplates, describeLibrary } from './src/template-card/index.js';
import { renderTemplateCardResult } from './src/core/render/template-card-renderer.js';

function line(t) { console.log(t); }

// 1. 场景路由
line(`RULE_SETS=${RULE_SETS.map((s) => s.scene_key).join(',')}`);
for (const msg of [
  '老人最近血压偏高，帮我做健康风险预警',
  '老人血糖波动大，想看看风险等级和命中的规则',
  '老人最近血压偏高，帮我做健康风险预警',
]) {
  const r = identifyScene({ message: msg, role: 'care_worker' });
  line(`ROUTE scene=${r.scene_key} decision=${r.decision} intent=${r.intent} top_conf=${r.confidence}`);
  const cands = (r.candidates || []).map((c) => `${c.scene_key}:${c.decision}:${c.confidence?.toFixed?.(2)}`).join(' | ');
  line(`  cands=${cands}`);
}
const hr = executeHealthRiskWarningRuleSet({ message: '老人血压偏高，帮我做健康风险预警', role: 'care_worker' });
line(`HRW decision=${hr.decision} confidence=${hr.confidence} score=${hr.score} positive=${hr.positive} intent=${hr.intent}`);

// 2. 知识种子
const ksvc = createKnowledgeDataService({ root: process.cwd() });
const hrw = await ksvc.documentStore.listBySkill('health_risk_warning');
line(`KB health_risk_warning docs=${hrw.length}`);
hrw.forEach((d) => line(`  - ${d.document_id} | ${d.title}`));

// 3. 模型填充
const filled = await fillTemplateSlots({
  message: '老人血压偏高，帮我做健康风险预警',
  template_id: 'health_warning_card',
  template_library: [{ id: 'health_warning_card' }],
});
line(`FILL template_id=${filled.template_id} level=${filled.data.level} signals=${filled.data.signals.length} rules=${filled.data.rules.length}`);
line(`ACTIONS=${filled.actions.map((a) => a.action_key).join(',')}`);

// 4. 卡片渲染
const rendered = renderTemplateCardResult({
  templateDir: path.join('src/skills/health_risk_warning/templates/html'),
  modelResult: filled,
});
line(`RENDER ok=${rendered.render_status} templateId=${rendered.card?.templateId} hasHtml=${String(rendered.rendered_html).includes('health-warning-card')}`);
line(`RENDER hasLevel=${String(rendered.rendered_html).includes(filled.data.level)}`);

// 5. 动作重新进入（信号卡）
const sigFilled = await fillTemplateSlots({
  message: '重新读取老人设备信号',
  template_id: 'health_risk_signal_card',
  template_library: [{ id: 'health_risk_signal_card' }],
});
line(`SIGNAL template_id=${sigFilled.template_id} signals=${sigFilled.data.signals.length} sourceLabel=${sigFilled.data.sourceLabel}`);
