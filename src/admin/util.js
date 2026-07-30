import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// 读取并解析请求体；解析失败返回 400 而非让连接崩溃
export async function readJsonSafe(req, res) {
  try {
    return await readJson(req);
  } catch {
    json(res, 400, { ok: false, error: 'invalid_json_body' });
    return undefined;
  }
}

// 掩码 api_key：保留前3后4，中间 ****；返回是否已有密钥
export function maskApiKey(key) {
  if (!key) return { masked: '', has: false };
  if (key.length <= 8) return { masked: '****', has: true };
  return { masked: key.slice(0, 3) + '****' + key.slice(-4), has: true };
}

export function sendStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    json(res, 404, { ok: false, error: 'static_file_not_found' });
    return;
  }
  res.writeHead(200, { 'content-type': type });
  res.end(fs.readFileSync(filePath));
}
