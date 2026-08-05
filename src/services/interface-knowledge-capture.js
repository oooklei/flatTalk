import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeQueue, contentHash } from './write-queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Persist external interface records into a skill-local knowledge cache.
 *
 * Storage:
 *   src/skills/<skillKey>/knowledge/interface_cache/<provider>_index.json
 *
 * Records are upserted by id so every sync refreshes the latest remote state
 * without creating duplicate cache entries.
 *
 * v2 改造（2026-08）：写入操作不再阻塞调用方，推入 writeQueue 异步执行。
 * 增加内容指纹去重：相同内容不重复写盘。
 */

/** 异步写入 JSON（替代 fs.writeFileSync 同步阻塞） */
function writeJsonAsync(file, data) {
  return new Promise((resolve, reject) => {
    fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * 将记录推入异步写入队列（不阻塞调用方）。
 * 返回 { written, total } 估算值（实际写入在后台完成）。
 */
export function captureToLocalKnowledge({ skillKey, provider, sourcePath = '', records = [], replace = false } = {}) {
  if (!skillKey || !provider) {
    console.warn('[KB-CAPTURE] missing skillKey/provider, skipped');
    return { written: 0, total: 0 };
  }

  const safeRecords = Array.isArray(records) ? records : [];
  const dir = path.join(ROOT, 'src', 'skills', skillKey, 'knowledge', 'interface_cache');
  const indexFile = path.join(dir, `${provider}_index.json`);
  const dedupKey = `${skillKey}/${provider}`;

  // 空记录 + replace 模式：清空文件也推入队列
  if (safeRecords.length === 0 && replace) {
    writeQueue.enqueue(
      async () => {
        fs.mkdirSync(dir, { recursive: true });
        await writeJsonAsync(indexFile, []);
      },
      dedupKey,
      'empty-replace'
    );
    console.log(`[KB-CAPTURE] skill=${skillKey} provider=${provider} queued: clear (replace)`);
    return { written: 0, total: 0 };
  }
  if (safeRecords.length === 0) return { written: 0, total: 0 };

  // 计算内容指纹用于去重
  const hash = contentHash(safeRecords);

  // 推入异步队列
  writeQueue.enqueue(
    async () => {
      fs.mkdirSync(dir, { recursive: true });

      let index = [];
      if (!replace && fs.existsSync(indexFile)) {
        try {
          index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        } catch {
          index = [];
        }
      }

      // 为没有 id 的记录生成伪 id（基于内容指纹）
      const normalizedRecords = safeRecords.map((record) => {
        if (record && record.id == null) {
          const pseudoId = contentHash([record]) || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          return { ...record, id: pseudoId };
        }
        return record;
      });

      const positionById = new Map(index.map((record, i) => [String(record.id), i]));
      const timestamp = new Date().toISOString();
      let written = 0;

      for (const record of normalizedRecords) {
        if (!record || record.id == null) continue;
        const id = String(record.id);
        const next = { ...record, id, _captured_at: timestamp, _source: sourcePath || provider };

        if (positionById.has(id)) {
          index[positionById.get(id)] = next;
        } else {
          positionById.set(id, index.length);
          index.push(next);
        }
        written += 1;
      }

      if (written > 0) {
        await writeJsonAsync(indexFile, index);
      }
      console.log(`[KB-CAPTURE] skill=${skillKey} provider=${provider} written=${written} total=${index.length}`);
    },
    dedupKey,
    hash
  );

  // 返回估算值（实际写入在后台完成）
  return { written: safeRecords.length, total: safeRecords.length };
}
