// 火山引擎豆包调用测试
// - 若设置了 FLATTALK_MODEL_VOLCENGINE_API_KEY，走 Bearer（Ark API Key，支持 Model ID 直调）
// - 否则回退 AK/SK V4 签名（仅支持 Endpoint ID，Model ID 直调会 401）
// 用法: node scripts/test-volc-doubao.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signVolcengineRequest } from '../src/core/model-runtime/volcengine-signer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 手动加载 .env
const envText = readFileSync(resolve(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const ARK_KEY = process.env.FLATTALK_MODEL_VOLCENGINE_API_KEY || '';
const AK = process.env.VOLC_ACCESS_KEY_ID;
const SK = process.env.VOLC_SECRET_ACCESS_KEY;
const BASE = 'https://ark.cn-beijing.volces.com/api/v3';

// 待测模型 Model ID
const MODELS = [
  'doubao-1-5-pro-32k-250115',
  'doubao-1-5-lite-32k-250115',
  'doubao-1-pro-256k-240628',
];

const mode = ARK_KEY ? 'Bearer (Ark API Key)' : 'AK/SK V4 签名';
console.log('=== 火山引擎豆包调用测试 ===');
console.log('鉴权方式:', mode);
if (ARK_KEY) console.log('Ark Key:', ARK_KEY.slice(0, 8) + '...' + ARK_KEY.slice(-3));
else console.log('提示: 未设置 FLATTALK_MODEL_VOLCENGINE_API_KEY，AK/SK 直调 Model ID 预期 401');
console.log('');

async function callOnce(modelId) {
  const endpoint = `${BASE}/chat/completions`;
  const body = JSON.stringify({
    model: modelId,
    messages: [{ role: 'user', content: '用一句话介绍广西巴马' }],
    max_tokens: 100,
    temperature: 0.3,
    stream: false,
  });
  let headers;
  if (ARK_KEY) {
    headers = { authorization: `Bearer ${ARK_KEY}`, 'content-type': 'application/json; charset=utf-8' };
  } else {
    const signed = signVolcengineRequest({ accessKeyId: AK, secretAccessKey: SK, region: 'cn-beijing', service: 'ark', method: 'POST', url: endpoint, body });
    headers = signed.headers;
  }
  const t0 = Date.now();
  const resp = await fetch(endpoint, { method: 'POST', headers, body });
  const dt = Date.now() - t0;
  const text = await resp.text();
  let obj = {};
  try { obj = JSON.parse(text); } catch { obj = { raw: text.slice(0, 300) }; }
  return { status: resp.status, dt, obj };
}

for (const m of MODELS) {
  try {
    const r = await callOnce(m);
    const ok = r.status === 200;
    const content = r.obj?.choices?.[0]?.message?.content || '';
    console.log(`[${ok ? 'OK' : r.status}] ${m}  (${r.dt}ms)`);
    if (ok && content) {
      console.log('  回复:', String(content).slice(0, 120).replace(/\n/g, ' '));
    } else {
      const errMsg = r.obj?.error?.message || r.obj?.message || JSON.stringify(r.obj).slice(0, 200);
      console.log('  错误:', errMsg);
    }
  } catch (e) {
    console.log(`[ERR] ${m}: ${e.message}`);
  }
  console.log('');
}
