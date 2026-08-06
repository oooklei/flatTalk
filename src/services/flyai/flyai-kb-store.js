import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_DIR = path.resolve(moduleDir, '../../../data/flyai-kb');

function isDocFile(name) {
  return name.endsWith('.json') && name !== 'seeds.json' && !name.endsWith('.raw.json');
}

/**
 * @param {{ baseDir?: string }} [opts]
 */
export function createFlyaiKbStore({ baseDir = DEFAULT_BASE_DIR } = {}) {
  const root = path.resolve(baseDir);
  const rawDir = path.join(root, 'raw');

  function ensureDirs() {
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(rawDir, { recursive: true });
  }

  function upsertDoc(doc) {
    if (!doc?.linked_route_id) {
      throw new Error('linked_route_id required');
    }
    ensureDirs();

    const id = String(doc.linked_route_id);
    const updatedAt = doc.updated_at || new Date().toISOString();
    const ts = updatedAt.replace(/[:.]/g, '-');
    const rawRel = path.join('raw', `${id}-${ts}.json`).replace(/\\/g, '/');
    const rawAbs = path.join(root, rawRel);
    const docPath = path.join(root, `${id}.json`);

    const record = {
      ...doc,
      updated_at: updatedAt,
      raw_path: rawRel,
    };

    fs.writeFileSync(rawAbs, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    fs.writeFileSync(docPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    return { path: docPath, rawPath: rawAbs, doc: record };
  }

  function listDocs() {
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root)
      .filter(isDocFile)
      .map((name) => {
        const text = fs.readFileSync(path.join(root, name), 'utf8');
        return JSON.parse(text);
      });
  }

  function getByRouteId(id) {
    if (!id) return null;
    const docPath = path.join(root, `${id}.json`);
    if (!fs.existsSync(docPath)) return null;
    return JSON.parse(fs.readFileSync(docPath, 'utf8'));
  }

  function getByKeyword(kw) {
    const needle = String(kw || '').trim().toLowerCase();
    if (!needle) return [];

    return listDocs().filter((doc) => {
      const parts = [
        ...(Array.isArray(doc.keywords) ? doc.keywords : []),
        doc.title || '',
        doc.destination || '',
        doc.query || '',
      ];
      return parts.some((part) => String(part).toLowerCase().includes(needle));
    });
  }

  return {
    baseDir: root,
    upsertDoc,
    listDocs,
    getByRouteId,
    getByKeyword,
  };
}

const defaultStore = createFlyaiKbStore();

export function upsertDoc(doc) {
  return defaultStore.upsertDoc(doc);
}

export function listDocs() {
  return defaultStore.listDocs();
}

export function getByRouteId(id) {
  return defaultStore.getByRouteId(id);
}

export function getByKeyword(kw) {
  return defaultStore.getByKeyword(kw);
}
