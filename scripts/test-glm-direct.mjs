// 直接测试 GLM 接口响应，定位 LLM 返回为空的根因
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REG_PATH = path.join(ROOT, 'data', 'model-registry.json');

const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
const model = reg.models.find((m) => m.is_active && m.model_type === 'llm_text' && m.is_default) || reg.models.find((m) => m.model_id === 'glm-4-flash');
console.log('使用模型:', model.model_id, 'api_base:', model.api_base);

const apiKey = model.api_key;
const url = `${model.api_base.replace(/\/$/, '')}/chat/completions`;

// 简单 prompt
const prompt = '只回复JSON：{"destination":"广西北海"}';
console.log('prompt:', prompt);
console.log('url:', url);

const payload = {
  model: model.model_id,
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 100,
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
  const text = await resp.text();
  console.log('原始响应(前1000字符):', text.slice(0, 1000));
  
  if (resp.ok) {
    try {
      const data = JSON.parse(text);
      console.log('\n解析后结构:');
      console.log('  choices:', data.choices?.length, '个');
      console.log('  content:', JSON.stringify(data.choices?.[0]?.message?.content));
      console.log('  finish_reason:', data.choices?.[0]?.finish_reason);
      console.log('  usage:', data.usage);
    } catch (e) {
      console.log('JSON 解析失败:', e.message);
    }
  }
} catch (e) {
  console.error('fetch 异常:', e.name, e.message);
}
