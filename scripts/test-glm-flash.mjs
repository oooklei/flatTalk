// 直接测试 GLM-4-Flash 接口响应（非推理模型，避免 reasoning_tokens 消耗）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REG_PATH = path.join(ROOT, 'data', 'model-registry.json');

const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
// 优先 glm-4-flash（非推理），避免 glm-5.2 的 reasoning_tokens 占满配额
const model = reg.models.find((m) => m.model_id === 'glm-4-flash' && m.is_active) || reg.models.find((m) => m.is_active && m.model_type === 'llm_text');
console.log('使用模型:', model.model_id);

const apiKey = model.api_key;
const url = `${model.api_base.replace(/\/$/, '')}/chat/completions`;

const prompt = `你是旅居产品数据分析助手。请根据产品信息推理目的地。

产品名：0730测试旅居路线5天4日游
价格：约222元/人

请严格按以下JSON格式返回（不要有任何额外文字、不要markdown代码块）：
{"destination":"广西XX市/县","reason":"推理依据"}

注意：destination必须是广西的市/县名。如果产品名含地名直接提取。`;

console.log('prompt 长度:', prompt.length);

const payload = {
  model: model.model_id,
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 500,  // 增加到 500，给非推理模型足够空间
  temperature: 0.3,
  stream: false,
};

const t0 = Date.now();
try {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log(`HTTP=${resp.status} elapsed=${Date.now() - t0}ms`);
  const data = await resp.json();
  console.log('content:', JSON.stringify(data.choices?.[0]?.message?.content));
  console.log('finish_reason:', data.choices?.[0]?.finish_reason);
  console.log('usage:', JSON.stringify(data.usage));
  console.log('reasoning_content:', JSON.stringify(data.choices?.[0]?.message?.reasoning_content)?.slice(0, 200));
} catch (e) {
  console.error('异常:', e.message);
}
