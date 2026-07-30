// 两阶段 + 工具调用（结构化输出）完整 demo，无需真实 LLM，用 mock 模型模拟。
// 阶段一：模型读模板语义描述(match) 选 template_id
// 阶段二：由模板反推 JSON Schema，强制模型只输出这些 key → 与模板 {{占位符}} 对齐
//
// 运行：node examples/two-stage-demo.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  discoverTemplates,
  buildSelectPrompt,
  jsonSchemaFor,
  renderCard,
} from '../src/template-card/index.js';

const DIR = path.join('examples', 'cards');
const OUT = path.join('examples', 'output');

// ---------- mock 模型（模拟真实 LLM 的两阶段行为）----------
const mockLLM = {
  // 阶段一：用「语义描述与问题的中文字符重叠」模拟语义选择（真实场景换成 LLM 调用）
  selectTemplateId(question, templates) {
    const cjk = (s) => (s.match(/[一-龥]/g) || []);
    const score = (t) => {
      const hay = (t.match || '') + t.id;
      const set = new Set(cjk(hay));
      return cjk(question).filter((c) => set.has(c)).length;
    };
    let best = templates[0]?.id || 'markdown_card';
    let bestScore = -1;
    for (const t of templates) {
      const s = score(t);
      if (s > bestScore) { bestScore = s; best = t.id; }
    }
    return best;
  },
  // 阶段二：按 schema 返回数据（真实场景把 schema 作为 function-calling / JSON mode 约束传入）
  fillData(templateId, schema) {
    const MOCK = {
      health_card: {
        title: '今日健康概览',
        metrics: [
          { label: '静息心率', value: '72 bpm' },
          { label: '睡眠时长', value: '6.8 小时' },
          { label: '步数', value: '8421' },
        ],
        foot: '数据更新于 08:00',
      },
      route_card: { time: '09:00', place: '杭州东站', note: '高铁出发，前往上海' },
    };
    if (MOCK[templateId]) return MOCK[templateId];
    // 通用兜底：按 schema 结构生成占位值
    const out = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      if (v.type === 'array') {
        const item = {};
        for (const ik of Object.keys(v.items.properties)) item[ik] = `示例${ik}`;
        out[k] = [item];
      } else out[k] = `示例${k}`;
    }
    return out;
  },
};

// ---------- 真实两阶段流程 ----------
function runTwoStage(question) {
  const templates = discoverTemplates(DIR);

  // 阶段一：生成“选模板”提示词 + 模型返回 id
  const stage1Prompt = buildSelectPrompt(templates, question);
  const templateId = mockLLM.selectTemplateId(question, templates);
  const template = templates.find((t) => t.id === templateId);

  // 阶段二：由模板反推 JSON Schema（强约束），模型按 schema 填数据
  const schema = jsonSchemaFor(template);
  const data = mockLLM.fillData(templateId, schema);

  // 校验：模型输出必须只含 schema 字段，且 required 齐全（强约束的体现）
  const extra = Object.keys(data).filter((k) => !(k in schema.properties));
  const missing = schema.required.filter((k) => !(k in data));
  if (extra.length || missing.length) {
    throw new Error(`schema 校验失败: 多余=${extra} 缺失=${missing}`);
  }

  // 渲染：用模型选定的 id + 数据 → 数据置换进模板，样式不变
  const res = renderCard(DIR, { template_id: templateId, data });

  return { question, stage1Prompt, templateId, schema, data, res, extra, missing };
}

// ---------- 执行两个场景并打印 ----------
fs.mkdirSync(OUT, { recursive: true });
const scenarios = [
  '今天我的心率和睡眠情况怎么样？有什么建议？',
  '帮我规划从杭州到上海的行程路线，沿途经过几个城市。',
];

for (const [i, q] of scenarios.entries()) {
  const r = runTwoStage(q);
  const file = path.join(OUT, `twostage_${i + 1}.html`);
  fs.writeFileSync(file, r.res.pages[0]);

  console.log(`\n========== 场景 ${i + 1} ==========`);
  console.log('用户问题 :', r.question);
  console.log('阶段一提示词:\n' + r.stage1Prompt.split('\n').map((l) => '  ' + l).join('\n'));
  console.log('→ 模型选定模板 id :', r.templateId, '| 布局:', r.res.layout);
  console.log('阶段二 JSON Schema:\n  ' + JSON.stringify(r.schema));
  console.log('→ 模型按 schema 返回数据 :', JSON.stringify(r.data));
  console.log('schema 校验 :', r.extra.length === 0 && r.missing.length === 0 ? '通过（key 完全对齐）✅' : '失败❌');
  console.log('渲染结果 :', r.res.cardCount, '张卡片 /', r.res.pageCount, '页 →', file);
}
console.log('\n全部场景完成。');
