// LongCat 端到端测试：通过 flatTalk 调用链验证 Anthropic 适配器
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickChatModel, publicModelName } from '../src/core/model-runtime/model-registry.js';
import { callOpenAiCompatibleModel } from '../src/core/model-runtime/openai-compatible-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 手动加载 .env
const envText = readFileSync(resolve(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// 1. 验证 pickChatModel 选中 LongCat
const model = pickChatModel();
console.log('=== LongCat 端到端测试 ===');
console.log('pickChatModel 选中:', publicModelName(model), `(id=${model?.id}, provider=${model?.provider})`);

if (!model) {
  console.log('ERROR: 未选中模型');
  process.exit(1);
}

// 2. 测试简单对话
console.log('\n--- 测试1: 简单对话 ---');
const r1 = await callOpenAiCompatibleModel(model, [
  { role: 'user', content: '用一句话介绍广西巴马长寿村' },
], { maxTokens: 200, temperature: 0.6 });

console.log('状态:', r1.ok ? 'OK' : `FAIL(${r1.status})`, r1.http_status || '');
if (r1.ok) {
  console.log('回复:', r1.content.replace(/\n/g, ' ').slice(0, 200));
} else {
  console.log('错误:', r1.error);
}

// 3. 测试 system + user（验证 system 分离逻辑）
console.log('\n--- 测试2: system + user ---');
const r2 = await callOpenAiCompatibleModel(model, [
  { role: 'system', content: '你是一个康养旅居助手，回答简洁。' },
  { role: 'user', content: '北海适合老人过冬吗？' },
], { maxTokens: 200, temperature: 0.5 });

console.log('状态:', r2.ok ? 'OK' : `FAIL(${r2.status})`, r2.http_status || '');
if (r2.ok) {
  console.log('回复:', r2.content.replace(/\n/g, ' ').slice(0, 200));
} else {
  console.log('错误:', r2.error);
}

console.log('\n=== 测试完成 ===');
