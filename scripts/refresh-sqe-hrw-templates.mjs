/**
 * 从新制作的 *-templates 包刷新 service_quality_eval / health_risk_warning：
 * - 覆盖 html + manifest（并按 TEMPLATE-AUTHORING 补 name / intent_id / match 字符串）
 * - 同步 sample.json / preview / _mobile_base.css
 * - 保留 health_manual_review_card（新包无，旧派生卡）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SQE_SRC = path.join(ROOT, 'service_quality_eval-templates');
const HRW_SRC = path.join(ROOT, 'health_risk_warning-templates');
const SQE_DST = path.join(ROOT, 'flatTalk/src/skills/service_quality_eval/templates');
const HRW_DST = path.join(ROOT, 'flatTalk/src/skills/health_risk_warning/templates');

/** template_id → { intent_id, name, match } */
const SQE_META = {
  institution_quality_report: {
    intent_id: 'service_quality_eval.report',
    name: '机构服务质量评估报告',
    match: '展示机构综合质量评估报告（评分/百分位/投诉口碑/AI建议），非人员报告或排名榜',
  },
  staff_quality_report: {
    intent_id: 'service_quality_eval.staff',
    name: '服务人员质量评估报告',
    match: '展示单名护理员/服务人员质量评估档案，非机构报告、非人员排名',
  },
  org_quality_ranking: {
    intent_id: 'service_quality_eval.org_rank',
    name: '机构质量排名',
    match: '展示辖区机构质量排名榜单，非单机构评估报告',
  },
  staff_quality_ranking: {
    intent_id: 'service_quality_eval.staff_rank',
    name: '服务人员质量排名',
    match: '展示服务人员质量排名榜单，非单人员评估档案',
  },
  rectification_suggestion: {
    intent_id: 'service_quality_eval.rectify',
    name: '整改建议',
    match: '展示薄弱项与可执行整改建议，非投诉详情、非评估标准',
  },
  complaint_detail: {
    intent_id: 'service_quality_eval.complaint',
    name: '投诉详情',
    match: '展示单条投诉工单详情与处理时间线，非机构报告或整改清单',
  },
  evaluation_standard: {
    intent_id: 'service_quality_eval.standard',
    name: '评估标准',
    match: '展示评估维度/权重/口径的只读标准卡，非报告或整改建议',
  },
};

const HRW_META = {
  health_warning_card: {
    intent_id: 'health_risk_warning.assess',
    name: '健康风险预警结果',
    match: '展示综合健康风险预警结果（等级+信号+规则），非完整报告、非等级标准说明',
  },
  risk_assessment_card: {
    intent_id: 'health_risk_warning.assessment',
    name: '综合风险评估',
    match: '展示综合风险评估详情（多模块指标），非简版预警结果卡',
  },
  risk_warning_card: {
    intent_id: 'health_risk_warning.warning',
    name: '健康风险预警提示',
    match: '展示风险提示/预警列表短卡，非完整评估报告',
  },
  health_risk_signal_card: {
    intent_id: 'health_risk_warning.signal_detail',
    name: '设备信号明细',
    match: '展示设备信号明细（血压/血糖/心率等），非规则命中卡',
  },
  health_risk_rule_card: {
    intent_id: 'health_risk_warning.rule_detail',
    name: '风险规则命中',
    match: '展示风险规则命中与判定明细，非信号明细、非综合报告',
  },
  health_report_card: {
    intent_id: 'health_risk_warning.report',
    name: '完整健康报告',
    match: '展示完整健康/风险评估报告（多模块），非单卡预警结果',
  },
  care_advice_card: {
    intent_id: 'health_risk_warning.advice',
    name: '个性化调理方案',
    match: '展示中药/穴位/膳食/运动调理方案，非膳食调养专卡',
  },
  dietary_regimen_card: {
    intent_id: 'health_risk_warning.dietary',
    name: '膳食调养建议',
    match: '展示宜食忌食与食疗配方的膳食调养卡，非综合调理方案卡',
  },
  constitution_card: {
    intent_id: 'health_risk_warning.constitution',
    name: '体质辨识',
    match: '展示九种体质辨识结果，非证候/舌诊/面诊卡',
  },
  tongue_diagnosis_card: {
    intent_id: 'health_risk_warning.tongue',
    name: '舌象辨识',
    match: '展示舌诊/舌象指标，非面诊或体质卡',
  },
  face_observation_card: {
    intent_id: 'health_risk_warning.face',
    name: '面象辨识',
    match: '展示面诊/面象指标，非舌诊或体质卡',
  },
  tcm_syndrome_card: {
    intent_id: 'health_risk_warning.syndrome',
    name: '中医证候',
    match: '展示中医证候/证型，非体质辨识卡',
  },
  risk_level_card: {
    intent_id: 'health_risk_warning.risk_level',
    name: '风险等级标准',
    match: '展示风险等级五级标准说明，非当前评估结果卡',
  },
  help_card: {
    intent_id: 'health_risk_warning.help',
    name: '使用帮助',
    match: '展示健康风险技能使用帮助，非评估结果',
  },
  elder_duplicate_confirm_card: {
    intent_id: 'health_risk_warning.elder_confirm',
    name: '同名老人确认',
    match: '展示同名老人候选确认，非风险评估结果',
  },
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function writeManifest(dstPath, baseFromSrc, meta) {
  const raw = JSON.parse(fs.readFileSync(baseFromSrc, 'utf8'));
  const next = {
    id: raw.id || meta.template_id || path.basename(dstPath, '.manifest.json'),
    name: meta.name,
    description: raw.description || meta.match,
    product_domain: meta.intent_id.split('.')[0].includes('service_quality')
      ? 'service_quality_eval'
      : 'health_risk_warning',
    intent_id: meta.intent_id,
    required: raw.required || [],
    optional_fields: raw.optional_fields || raw.optional || [],
    match: meta.match,
    layout: raw.layout || 'vertical',
    followup_actions: raw.followup_actions || raw.followupActions || [],
    version: raw.version || '1.0',
  };
  if (raw.derived_from) next.derived_from = raw.derived_from;
  if (raw.slot_hints) next.slot_hints = raw.slot_hints;
  if (raw.render_priority != null) next.render_priority = raw.render_priority;
  fs.writeFileSync(dstPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function refreshSkill({ srcRoot, dstRoot, metaMap, skillKey }) {
  const htmlSrc = path.join(srcRoot, 'html');
  const dataSrc = path.join(srcRoot, 'data');
  const previewSrc = path.join(srcRoot, 'preview');
  const htmlDst = path.join(dstRoot, 'html');
  const dataDst = path.join(dstRoot, 'data');
  const previewDst = path.join(dstRoot, 'preview');
  ensureDir(htmlDst);
  ensureDir(dataDst);
  ensureDir(previewDst);

  const report = { skill: skillKey, copied_html: [], manifests: [], samples: [], previews: [], skipped: [] };

  for (const [templateId, meta] of Object.entries(metaMap)) {
    const htmlFile = path.join(htmlSrc, `${templateId}.html`);
    const manFile = path.join(htmlSrc, `${templateId}.manifest.json`);
    if (!fs.existsSync(htmlFile) || !fs.existsSync(manFile)) {
      report.skipped.push(templateId);
      continue;
    }
    copyFile(htmlFile, path.join(htmlDst, `${templateId}.html`));
    report.copied_html.push(templateId);
    writeManifest(path.join(htmlDst, `${templateId}.manifest.json`), manFile, { ...meta, template_id: templateId });
    report.manifests.push(templateId);

    const sample = path.join(dataSrc, `${templateId}.sample.json`);
    if (fs.existsSync(sample)) {
      copyFile(sample, path.join(dataDst, `${templateId}.sample.json`));
      // authoring 也允许 html 旁 sample
      copyFile(sample, path.join(htmlDst, `${templateId}.sample.json`));
      report.samples.push(templateId);
    }
    const preview = path.join(previewSrc, `${templateId}.preview.html`);
    if (fs.existsSync(preview)) {
      copyFile(preview, path.join(previewDst, `${templateId}.preview.html`));
      report.previews.push(templateId);
    }
  }

  const css = path.join(htmlSrc, '_mobile_base.css');
  if (fs.existsSync(css)) {
    copyFile(css, path.join(htmlDst, '_mobile_base.css'));
    report.css = '_mobile_base.css';
  }
  const previewIndex = path.join(previewSrc, 'index.html');
  if (fs.existsSync(previewIndex)) {
    copyFile(previewIndex, path.join(previewDst, 'index.html'));
    report.preview_index = true;
  }

  // 明确不拷 chatbot.html
  report.excluded = ['chatbot.html'];
  return report;
}

const sqe = refreshSkill({
  srcRoot: SQE_SRC,
  dstRoot: SQE_DST,
  metaMap: SQE_META,
  skillKey: 'service_quality_eval',
});
const hrw = refreshSkill({
  srcRoot: HRW_SRC,
  dstRoot: HRW_DST,
  metaMap: HRW_META,
  skillKey: 'health_risk_warning',
});

// 保留并校验派生卡
const manualMan = path.join(HRW_DST, 'html', 'health_manual_review_card.manifest.json');
const manualHtml = path.join(HRW_DST, 'html', 'health_manual_review_card.html');
const keptManual = fs.existsSync(manualHtml) && fs.existsSync(manualMan);
if (keptManual) {
  const m = JSON.parse(fs.readFileSync(manualMan, 'utf8'));
  if (!m.intent_id) {
    m.intent_id = 'health_risk_warning.manual_review';
    m.name = m.name || '人工复核申请';
    m.match = m.match || '展示人工复核申请状态与进度的卡片，非风险评估结果';
    m.derived_from = m.derived_from || 'health_warning_card';
    fs.writeFileSync(manualMan, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
  }
}

const out = {
  generated_at: new Date().toISOString(),
  service_quality_eval: sqe,
  health_risk_warning: { ...hrw, kept_manual_review_card: keptManual },
  principle: '1 intent_id ↔ 1 template_id; non-synonym anchors stay separate intents',
};
const outPath = path.join(ROOT, 'qa/lis-flattalk-audit/reports/template-refresh-sqe-hrw.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
