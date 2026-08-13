// 测试火山引擎豆包模型调用（V4 签名）
// 用法: node scripts/test-volcengine-doubao.mjs
import 'dotenv/config';
import { readModelRegistry } from '../src/core/model-runtime/model-registry.js';
import { callOpenAiCompatibleModel } from '../src/core/model-runtime/openai-compatible-client.js';

const models = readModelRegistry();
const volcModels = models.filter((m) => m.provider === 'volcengine' && m.is_active);

console.log('=== 火山引擎豆包模型测试 ===');
console.log('VOLC_ACCESS_KEY_ID:', process.env.VOLC_ACCESS_KEY_ID ? `${process.env.VOLC_ACCESS_KEY_ID.slice(0, 10)}...` : 'MISSING');
console.log('VOLC_SECRET_ACCESS_KEY:', process.env.VOLC_SECRET_ACCESS_KEY ? 'SET' : 'MISSING');
console.log('已配置豆包模型:', volcModels.map((m) => `${m.name}(${m.model_id})`).join(', '));
console.log('');

const prompt = '你是旅居产品数据分析助手。请用一句话介绍广西巴马的特色景点。';
console.log('测试 prompt:', prompt);
console.log('');

for (const model of volcModels) {
  console.log(`\n========== ${model.display_name} ==========`);
  console.log(`model_id: ${model.model_id}`);
  console.log(`api_base: ${model.api_base}`);
  const t0 = Date.now();
  try {
    const result = await callOpenAiCompatibleModel(
      model,
      [{ role: 'user', content: prompt }],
      { maxTokens: 200, timeoutMs: 20000 }
    );
    const elapsed = Date.now() - t0;
    if (result.ok) {
      console.log(`✅ 成功 (${elapsed}ms)`);
      console.log('回复:', result.content.slice(0, 300));
      console.log('tokens:', result.raw?.usage);
    } else {
      console.log(`❌ 失败 [${result.status}] HTTP=${result.http_status || '-'}`);
      console.log('错误:', result.error);
      if (result.raw?.error) console.log('详情:', JSON.stringify(result.raw.error).slice(0, 400));
    }
  } catch (e) {
    console.log(`💥 异常: ${e.message}`);
  }
}
