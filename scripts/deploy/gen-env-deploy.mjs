// 从本地 flatTalk/.env 生成部署用 .env.deploy：
//   1. 移除 43.138.143.130（女娲 KB）相关全部变量
//   2. 移除 192.168.1.160 内网地址（改由 compose 注入容器服务名）
//   3. 保留第三方密钥（LLM/地图/天气/JTD/舌诊/火山等）
import fs from 'node:fs';

const SRC = 'd:/GuiCare/flatTalk/.env';
const OUT = 'd:/GuiCare/flatTalk/.env.deploy';

// 由 compose 显式注入，或已废弃 —— 一律不带入
const DROP_KEYS = new Set([
  'FLATTALK_HOST', 'FLATTALK_PORT', 'FLATTALK_SSL_PORT', 'FLATTALK_RUNTIME_MODE',
  'FLATTALK_PG_URL', 'FLATTALK_TAG_SYSTEM_PG_URL', 'FLATTALK_REDIS_URL',
  'FLATTALK_TAG_SYSTEM_BASE_URL', 'DATABASE_URL',
  'FLATTALK_KB_BASE_URL', 'FLATTALK_KB_SEARCH_PATH', 'FLATTALK_KB_TICKET',
  'FLATTALK_KB_TIMEOUT_MS', 'FLATTALK_KB_DEFAULT_COLLECTIONS',
  'FLATTALK_KB_MEAL_PLAN_COLLECTIONS', 'FLATTALK_KB_REMOTE_ONLY', 'ENABLE_TAG_SYSTEM',
  'LIS_BASE_URL', 'FLATTALK_LIS_BASE_URL',
  // 女娲平台（43 机器）整套废弃，已由 gxy-local-kb 取代
  'NUWAX_BASE_URL', 'NUWAX_URL', 'NUWAX_PUBLIC_URL', 'NUWAX_ACCOUNT',
  'NUWAX_PASSWORD', 'NUWAX_SPACE_ID', 'NUWAX_ROUTER_AGENT_ID',
  'NUWAX_AGENT_MODEL_ID', 'NUWAX_EMBEDDING_MODEL_ID', 'NUWAX_REQUEST_TIMEOUT_MS',
]);

const src = fs.readFileSync(SRC, 'utf8');
const out = [
  '# flatTalk 部署环境（由 gen-env-deploy.mjs 生成，勿手改）',
  '# 网络/DB/KB 地址由 docker-compose.gxy.yml 注入；此文件只带密钥与业务常量。',
  '# 已彻底移除女娲 KB（外网 43 机器）与 160 内网机的一切引用。',
  '',
];
const dropped = [];
const kept = [];

for (const rawLine of src.split(/\r?\n/)) {
  const line = rawLine.trimEnd();
  if (!line || line.startsWith('#')) continue;
  const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  const key = m[1];
  const val = m[2];

  if (DROP_KEYS.has(key)) { dropped.push(key); continue; }
  if (val.includes('43.138.143.130')) { dropped.push(key + '(43机器)'); continue; }

  let outLine = key + '=' + val;
  // 内部服务：本机/160/开发机(192.168.1.2) → 容器服务名
  if (key === 'PROFILE_TAG_API_BASE_URL' || key === 'ELDER_PROFILE_API_BASE_URL') {
    outLine = key + '=http://gxy-tag:8010';
  } else if (val.includes('192.168.1.160:8010') || val.includes('192.168.1.2:8010')) {
    outLine = outLine.replace(/http:\/\/192\.168\.1\.(160|2):8010/g, 'http://gxy-tag:8010');
  } else if (val.includes('192.168.1.160')) {
    dropped.push(key + '(160机器)');
    continue;
  } else if (val.includes('192.168.1.2') || val.includes('127.0.0.1')) {
    dropped.push(key + '(开发机地址)');
    continue;
  }

  out.push(outLine);
  kept.push(key);
}

fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');

const written = fs.readFileSync(OUT, 'utf8');
const leak = written.match(/43\.138\.143\.130|192\.168\.1\.160/g);
console.log('生成 ' + OUT);
console.log('保留 ' + kept.length + ' 项, 丢弃 ' + dropped.length + ' 项');
console.log('丢弃: ' + dropped.join(', '));
console.log('残留 43/160 引用: ' + (leak ? leak.length : 0));
