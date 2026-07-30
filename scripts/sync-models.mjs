// 同步外部「模型」到 flatTalk 的 data/model-registry.json
// 数据源 A：本地 microfilm 库（MySQL，库名 aippt，表 llm_models）
// 数据源 B：远程平台 http://43.138.143.130:9015 （/api/v1/models，需 API Key）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

const ROOT = process.cwd();
const REGISTRY = path.join(ROOT, 'data', 'model-registry.json');

// ---------- 配置（可被环境变量覆盖）----------
const CFG = {
  microfilm: {
    enabled: env('SYNC_MICROFILM', 'true') !== 'false',
    host: env('MICROFILM_DB_HOST', '127.0.0.1'),
    port: Number(env('MICROFILM_DB_PORT', '3306')),
    user: env('MICROFILM_DB_USER', 'root'),
    password: env('MICROFILM_DB_PASSWORD', 'root'),
    database: env('MICROFILM_DB_NAME', 'aippt'),
    table: env('MICROFILM_TABLE', 'llm_models'),
    aesKey: env('MICROFILM_AES_KEY', '30ba1168fff9e65da076e2646bf0a493'),
  },
  remote: {
    enabled: Boolean(env('REMOTE_API_KEY')),
    base: env('REMOTE_BASE', 'http://43.138.143.130:9015'),
    endpoint: env('REMOTE_ENDPOINT', '/api/v1/models'),
    user: env('REMOTE_USER', 'bansiyun@caih.com'),
    pass: env('REMOTE_PASS', 'bsy123'),
    apiKey: env('REMOTE_API_KEY', ''),
  },
  dryRun: process.argv.includes('--dry-run'),
};

function env(k, d) { return process.env[k] ?? d; }

// ---------- microfilm api_key 解密 ----------
// 仅当值「看起来像 AES 密文」（纯 base64 且长度>16 字节）时才解密；
// 否则（如明文智谱 key：db4af7b1....xxx.yyy 含点号）原样返回，避免清空真实密钥。
function decryptApiKey(enc, hexKey) {
  if (!enc) return '';
  const looksEncrypted = /^[A-Za-z0-9+/]+=*$/.test(enc) && Buffer.from(enc, 'base64').length > 16;
  if (!looksEncrypted) return enc; // 明文，直接返回
  try {
    const key = Buffer.from(hexKey, 'hex');
    const raw = Buffer.from(enc, 'base64');
    const iv = raw.subarray(0, 16);
    const ct = raw.subarray(16);
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    const pad = dec[dec.length - 1];
    if (pad > 0 && pad <= 16) dec = dec.subarray(0, dec.length - pad);
    return dec.toString('utf8');
  } catch {
    return enc; // 解密失败则保守地当作明文
  }
}

function mapMicrofilm(row) {
  const apiKey = decryptApiKey(row.api_key, CFG.microfilm.aesKey);
  return {
    name: String(row.name || '').trim(),
    display_name: row.display_name || row.name || '',
    provider: row.provider || 'unknown',
    api_base: row.api_base || '',
    model_id: row.model_id || '',
    model_type: row.model_type || 'llm_text',
    purpose: row.purpose || '',
    owner: row.owner || 'microfilm',
    is_active: Number(row.is_active ?? 1) !== 0,
    is_default: Number(row.is_default ?? 0) !== 0,
    sort_order: Number(row.sort_order ?? 0),
    max_tokens: row.max_tokens != null ? Number(row.max_tokens) : 4096,
    temperature: row.temperature != null ? Number(row.temperature) : 0.7,
    api_key: apiKey,
  };
}

async function fetchMicrofilm() {
  const m = CFG.microfilm;
  if (!m.enabled) return [];
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: m.host, port: m.port, user: m.user, password: m.password, database: m.database,
  });
  try {
    const [rows] = await conn.execute(`SELECT * FROM \`${m.table}\``);
    return rows.map(mapMicrofilm).filter((x) => x.name);
  } finally {
    await conn.end();
  }
}

// ---------- 远程平台 ----------
async function fetchRemote() {
  const r = CFG.remote;
  if (!r.enabled) {
    console.log('[remote] 跳过：未设置 REMOTE_API_KEY，无法调用 /api/v1/models');
    return [];
  }
  const loginUrl = `${r.base}/api/user/passwordLogin`;
  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phoneOrEmail: r.user, password: r.pass }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const cookie = loginRes.headers.get('set-cookie') || '';
  const ticket = (cookie.match(/ticket=([^;]+)/) || [])[1] || '';
  const url = `${r.base}${r.endpoint}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${r.apiKey}`,
      ...(ticket ? { cookie: `ticket=${ticket}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    console.log(`[remote] 拉取失败 http=${res.status} ${body?.message || ''}`);
    return [];
  }
  const list = body?.data?.records || body?.data?.list || body?.data || body?.list || [];
  return (Array.isArray(list) ? list : []).map(mapRemote).filter((x) => x.name);
}

function mapRemote(item) {
  const apiKey = item.apiKey || item.api_key || '';
  return {
    name: String(item.name || item.modelId || item.model_id || '').trim(),
    display_name: item.displayName || item.display_name || item.name || '',
    provider: item.provider || 'unknown',
    api_base: item.apiBase || item.api_base || '',
    model_id: item.modelId || item.model_id || '',
    model_type: item.modelType || item.model_type || 'llm_text',
    purpose: item.purpose || item.description || '',
    owner: item.owner || 'remote',
    is_active: item.isActive ?? item.is_active ?? true,
    is_default: item.isDefault ?? item.is_default ?? false,
    sort_order: Number(item.sortOrder ?? item.sort_order ?? 0),
    max_tokens: item.maxTokens ?? item.max_tokens ?? 4096,
    temperature: item.temperature ?? 0.7,
    api_key: apiKey,
  };
}

// ---------- 合并 ----------
function merge(existing, sources) {
  const byName = new Map();
  for (const m of existing) byName.set(m.name, { ...m, _src: 'existing' });
  for (const src of sources) {
    const cur = byName.get(src.name);
    if (!cur) {
      byName.set(src.name, { ...src, _src: 'new' });
    } else {
      // 来源覆盖；但 api_key 仅在来源有值时覆盖，避免清空已有密钥
      const merged = { ...cur };
      for (const k of Object.keys(src)) {
        if (k === 'id' || k === 'name') continue; // 保留原 id / name，避免破坏已有引用
        if (k === 'api_key') {
          if (src.api_key) merged.api_key = src.api_key;
        } else if (src[k] !== undefined && src[k] !== '') {
          merged[k] = src[k];
        }
      }
      merged._src = 'updated';
      byName.set(src.name, merged);
    }
  }
  let nextId = existing.reduce((mx, m) => Math.max(mx, Number(m.id) || 0), 0);
  const out = [];
  for (const m of byName.values()) {
    const { _src, ...rest } = m;
    if (rest.id == null || rest.id === '') rest.id = ++nextId;
    out.push(rest);
  }
  return { models: out, stats: summarize(byName) };
}

function summarize(map) {
  let added = 0, updated = 0, kept = 0;
  for (const m of map.values()) {
    if (m._src === 'new') added++;
    else if (m._src === 'updated') updated++;
    else kept++;
  }
  return { added, updated, kept, total: map.size };
}

// ---------- 主流程 ----------
async function main() {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const existing = Array.isArray(reg.models) ? reg.models : [];
  const sources = [];
  let microCount = 0;
  try {
    const mf = await fetchMicrofilm();
    microCount = mf.length;
    sources.push(...mf);
    console.log(`[microfilm] 拉取 ${mf.length} 个模型（已解密 api_key）`);
  } catch (e) {
    console.log(`[microfilm] 失败：${e.message}`);
  }
  const rm = await fetchRemote();
  if (rm.length) {
    sources.push(...rm);
    console.log(`[remote] 拉取 ${rm.length} 个模型`);
  }
  const { models, stats } = merge(existing, sources);
  console.log(`合并结果：新增 ${stats.added} / 更新 ${stats.updated} / 保留 ${stats.kept} / 共 ${stats.total}`);
  if (CFG.dryRun) {
    console.log('[dry-run] 未写入文件。预览前 5 条：');
    for (const m of models.slice(0, 5)) {
      console.log(`  - ${m.name} | ${m.provider}/${m.model_type} | key:${m.api_key ? '有(' + m.api_key.slice(0,3) + '..)' : '无'} | active:${m.is_active}`);
    }
    return;
  }
  fs.writeFileSync(REGISTRY, JSON.stringify({ ...reg, models }, null, 2));
  console.log(`已写入 ${REGISTRY}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
