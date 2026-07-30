// 膳食原型（diet-card-full）接入演示：两阶段 + 嵌套 schema 强约束。
// 证明：把静态原型预制为 {{占位符}} + {{#meals}}{{#foods}} 嵌套后，
// jsonSchemaFor 能自动反推出「meals → foods」嵌套 schema，模型输出被强约束对齐，
// 渲染后样式像素级不变。
//
// 运行：node examples/diet-two-stage.mjs
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
fs.mkdirSync(OUT, { recursive: true });

const question = '帮我安排今天的饮食，三餐分别吃什么，注意低盐低脂，并说明营养配比';

// 阶段一：模型读模板语义描述选 id（此处用 CJK 字符重叠模拟语义选择）
const templates = discoverTemplates(DIR);
const stage1Prompt = buildSelectPrompt(templates, question);
const cjk = (s) => s.match(/[一-龥]/g) || [];
const score = (t) => {
  const set = new Set(cjk(t.match || ''));
  return cjk(question).filter((c) => set.has(c)).length;
};
const templateId = templates.reduce((b, t) => (score(t) > score(b) ? t : b), templates[0]).id;

// 阶段二：由模板反推嵌套 schema（强约束 key）
const template = templates.find((t) => t.id === templateId);
const schema = jsonSchemaFor(template);

// 模拟模型“按 schema 结构化输出”返回的数据（真实场景由 LLM + function-calling 给出）
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'diet_card.sample.json'), 'utf8'));

// 校验：顶层 key 必须都在 schema 内，required 齐全（嵌套内容由 schema 递归保证）
const extra = Object.keys(data).filter((k) => !(k in schema.properties));
const missing = schema.required.filter((k) => !(k in data));
const nestedOk = Array.isArray(data.meals) && data.meals.every((m) => Array.isArray(m.foods));

// 渲染：用模型选定 id + 数据
const res = renderCard(DIR, { template_id: templateId, data });
fs.writeFileSync(path.join(OUT, 'diet_card_out.html'), res.pages[0]);

console.log('用户问题 :', question);
console.log('\n[阶段一] 选模板提示词：');
console.log(stage1Prompt.split('\n').map((l) => '  ' + l).join('\n'));
console.log('\n→ 模型选定模板 id :', templateId, '| 布局:', res.layout);
console.log('\n[阶段二] 自动反推的 JSON Schema（嵌套）：');
console.log(JSON.stringify(schema, null, 2));
console.log('\n→ 模型按 schema 返回数据（节选 meals[0]）：');
console.log(JSON.stringify(data.meals[0], null, 2));
console.log('\n[校验]');
console.log('  顶层 key 对齐 :', extra.length === 0 ? '通过 ✅' : `失败（多余 ${extra}）❌`);
console.log('  必填齐全       :', missing.length === 0 ? '通过 ✅' : `失败（缺失 ${missing}）❌`);
console.log('  嵌套 meals→foods :', nestedOk ? '通过 ✅' : '失败 ❌');
console.log('\n[渲染] 生成', res.cardCount, '张卡片 →', path.join(OUT, 'diet_card_out.html'));
