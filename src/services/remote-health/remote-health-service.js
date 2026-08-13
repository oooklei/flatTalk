import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createYz365Service } from '../yz365/index.js';
import { createShezhenService } from '../shezhen/shezhen-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CACHE_DIR = path.join(PROJECT_ROOT, 'src', 'skills', 'health_risk_warning', 'knowledge', 'interface_cache');

function readJsonArray(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function readProviderCache(provider) {
  return readJsonArray(path.join(CACHE_DIR, `${provider}_index.json`));
}

function summarizeRecords(records = []) {
  const sample = records.find((record) => record && typeof record === 'object') || null;
  return {
    recordCount: records.length,
    sampleFieldCount: sample ? Object.keys(sample).length : 0,
    sample,
  };
}

export class RemoteHealthService {
  constructor(options = {}) {
    this.yz365 = options.yz365Service ?? createYz365Service(options.yz365 ?? {});
    this.shezhen = options.shezhenService ?? createShezhenService(options.shezhen ?? {});
    this.options = options;
    this.lastSync = null;
    this.syncTtlMs = Number(options.syncTtlMs ?? 30000);
  }

  async syncAll(options = {}) {
    const now = Date.now();
    if (!options.force && this.lastSync && now - this.lastSync.time < this.syncTtlMs) {
      return this.lastSync.result;
    }

    const yz365 = await this.yz365.syncAll(options.yz365 ?? {});
    const shezhen = await this.shezhen.syncAll(options.shezhen ?? {});
    const cached = this.getCachedRecords();

    const result = {
      provider: 'remote-health',
      ok: yz365.ok || shezhen.ok,
      syncedAt: new Date().toISOString(),
      providers: { yz365, shezhen },
      cache: {
        yz365: summarizeRecords(cached.yz365),
        shezhen: summarizeRecords(cached.shezhen),
        all: summarizeRecords(cached.all),
      },
      warnings: [
        ...(Array.isArray(yz365.warnings) ? yz365.warnings : []),
        ...(Array.isArray(shezhen.warnings) ? shezhen.warnings : []),
      ],
    };
    this.lastSync = { time: now, result };
    return result;
  }

  getCachedRecords() {
    const yz365 = readProviderCache('yunzhen365');
    const shezhen = readProviderCache('yunzhen-shezhen');
    return {
      yz365,
      shezhen,
      all: [...yz365, ...shezhen],
    };
  }

  async buildRiskRemoteContext(options = {}) {
    // ★ 不再阻塞等待 syncAll（syncAll 已在 orchestrator 中异步触发）
    // 直接读缓存数据，缓存由后台 syncAll 异步更新
    const cached = this.getCachedRecords();
    const sync = this.lastSync?.result || null;
    const hasCache = cached.all.length > 0;
    const syncOk = Boolean(sync?.ok);
    // SHOULD：缓存不得冒充实时体征
    let sourceStatus = 'empty';
    if (hasCache && syncOk) sourceStatus = 'local_cache_synced';
    else if (hasCache) sourceStatus = 'stale_cache';
    const warnings = [
      ...(Array.isArray(sync?.warnings) ? sync.warnings : []),
    ];
    if (sourceStatus === 'stale_cache') {
      warnings.push('yunzhen_cache_stale_not_live');
    }
    if (sourceStatus === 'empty') {
      warnings.push('yunzhen_cache_empty');
    }
    return {
      provider: 'remote-health',
      required: false,
      ok: hasCache,
      live: syncOk && hasCache,
      stale: sourceStatus === 'stale_cache',
      source_status: sourceStatus,
      sync,
      records: cached.all,
      yz365_records: cached.yz365,
      shezhen_records: cached.shezhen,
      metrics: cached.all,
      warnings,
      degradeNote: sourceStatus === 'stale_cache'
        ? '云诊/舌诊数据来自本地缓存，非实时同步结果'
        : (sourceStatus === 'empty' ? '暂无云诊体征缓存' : undefined),
    };
  }
}

export function createRemoteHealthService(options = {}) {
  return new RemoteHealthService(options);
}
