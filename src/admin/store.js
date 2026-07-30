// 通用 JSON 注册表存储：data/<name>.json，结构 { items: [...] }
import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe } from './util.js';

const DATA = path.resolve('data');
fs.mkdirSync(DATA, { recursive: true });

export function readReg(name, fallback = { items: [] }) {
  const f = path.join(DATA, name + '.json');
  try {
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Array.isArray(obj)) return { items: obj };
    return obj.items ? obj : { items: [] };
  } catch {
    return fallback;
  }
}

export function writeReg(name, obj) {
  const f = path.join(DATA, name + '.json');
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
}

export function nextId(items) {
  return items.reduce((m, i) => Math.max(m, Number(i?.id) || 0), 0) + 1;
}

// 通用 CRUD 路由处理：/api/admin/registries/<name>[/<id>]
export async function handleRegistryApi(req, res, method, parts, name, allow) {
  if (!allow.includes(name)) {
    return { status: 403, body: { ok: false, error: 'forbidden_registry' } };
  }
  const id = parts[0];
  const data = readReg(name);
  if (method === 'GET') {
    if (id) {
      const item = data.items.find((i) => String(i.id) === id);
      return { status: item ? 200 : 404, body: item ? { ok: true, item } : { ok: false, error: 'not_found' } };
    }
    return { status: 200, body: { ok: true, items: data.items } };
  }
  if (method === 'POST') {
    const b = await readJsonSafe(req, res);
    if (b === undefined) return null;
    b.id = nextId(data.items);
    data.items.push(b);
    writeReg(name, data);
    return { status: 201, body: { ok: true, item: b } };
  }
  if (method === 'PUT') {
    const b = await readJsonSafe(req, res);
    if (b === undefined) return null;
    const it = data.items.find((i) => String(i.id) === id);
    if (!it) return { status: 404, body: { ok: false, error: 'not_found' } };
    Object.assign(it, b, { id: it.id });
    writeReg(name, data);
    return { status: 200, body: { ok: true, item: it } };
  }
  if (method === 'DELETE') {
    data.items = data.items.filter((i) => String(i.id) !== id);
    writeReg(name, data);
    return { status: 200, body: { ok: true } };
  }
  return { status: 405, body: { ok: false, error: 'method_not_allowed' } };
}
