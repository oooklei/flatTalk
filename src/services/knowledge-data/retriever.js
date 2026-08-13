import { recordDegrade } from '../../core/observability/degradation-monitor.js';

export function createKnowledgeRetriever({ chunkStore, vectorStore, remoteAdapter = null }) {
  const remoteOnly = String(process.env.FLATTALK_KB_REMOTE_ONLY || '').trim() === '1';

  return {
    async retrieve({ skill_key = 'meal_plan', query = '', limit = 3, filters = {} } = {}) {
      // 默认：本地优先 + 远程补充。
      // FLATTALK_KB_REMOTE_ONLY=1：停用进程内本地知识，全部走 remote KB（gxy-local-kb）。
      const seen = new Set();
      let local = [];
      let localStatus = 'local_disabled';

      if (!remoteOnly) {
        const skillKeys = Array.from(new Set([
          skill_key === 'common' ? 'common' : skill_key,
          ...(shouldIncludeCommonChunks(chunkStore, skill_key) ? ['common'] : []),
        ]));
        for (const sk of skillKeys) {
          const chunks = await listChunks(chunkStore, sk);
          const matches = await vectorStore.search({ query, chunks, limit });
          for (const m of matches) {
            const key = String(m.content || m.text || '').trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            local.push({ ...m, origin: 'local', skill_key: sk });
          }
        }
        localStatus = local.length ? 'local_hit' : 'local_empty';
      }

      if (!remoteAdapter?.enabled) {
        const merged = local.slice(0, Math.max(1, Number(limit) || 3));
        return {
          source: remoteOnly ? 'remote_only_but_disabled' : 'local_first',
          status: remoteOnly ? 'remote_not_configured' : localStatus,
          skill_key,
          local_status: localStatus,
          local_count: local.length,
          local_matches: local,
          remote_status: 'disabled',
          remote_count: 0,
          remote_matches: [],
          matches: merged,
        };
      }

      const remote = await remoteAdapter.search({ skill_key, query, limit, filters });
      const remoteMatches = (remote.ok && Array.isArray(remote.matches) ? remote.matches : [])
        .filter((m) => {
          const key = String(m.content || m.text || '').trim();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((m) => ({ ...m, origin: 'remote' }));

      if (remoteOnly) {
        if (!remote.ok) recordDegrade('kb_remote_failed', remote.error || remote.status || 'remote_failed');
        return {
          source: remote.source || 'remote_knowledge',
          status: remote.ok
            ? (remoteMatches.length ? 'remote_hit' : (remote.status || 'remote_empty'))
            : (remote.status || 'remote_failed'),
          skill_key,
          local_status: 'local_disabled',
          local_count: 0,
          local_matches: [],
          remote_status: remote.status || (remoteMatches.length ? 'remote_hit' : 'remote_empty'),
          remote_count: remoteMatches.length,
          remote_matches: remoteMatches,
          remote_error: remote.error || null,
          collections: remote.collections || [],
          matches: remoteMatches.slice(0, Math.max(1, Number(limit) || 3)),
        };
      }

      if (remote.ok) {
        if (local.length) recordDegrade('kb_local_hit', { detail: skill_key, local_count: local.length });
        const merged = [...local, ...remoteMatches].slice(0, Math.max(1, Number(limit) || 3));
        return {
          source: local.length ? 'local_first_remote_supplement' : (remote.source || 'remote_knowledge'),
          status: local.length ? 'local_hit' : (remote.status || (remoteMatches.length ? 'remote_hit' : 'remote_empty')),
          skill_key,
          local_status: localStatus,
          local_count: local.length,
          local_matches: local,
          remote_status: remote.status || (remoteMatches.length ? 'remote_hit' : 'remote_empty'),
          remote_count: remoteMatches.length,
          remote_matches: remoteMatches,
          collections: remote.collections || [],
          matches: merged,
        };
      }

      recordDegrade('kb_remote_failed', remote.error || remote.status || 'remote_failed');
      if (local.length) recordDegrade('kb_local_hit', { detail: skill_key, fallback: true });
      const merged = [...local, ...remoteMatches].slice(0, Math.max(1, Number(limit) || 3));
      return {
        source: 'flatTalk_knowledge_data_fallback',
        status: remote.status || 'remote_failed',
        skill_key,
        local_status: localStatus,
        local_count: local.length,
        local_matches: local,
        remote_status: remote.ok ? (remoteMatches.length ? 'remote_hit' : 'remote_empty') : (remote.status || 'remote_error'),
        remote_count: remoteMatches.length,
        remote_matches: remoteMatches,
        remote_error: remote.error || null,
        remote_http_status: remote.http_status || null,
        matches: merged,
      };
    },
  };
}

async function listChunks(chunkStore, skillKey) {
  if (skillKey === 'common' && typeof chunkStore.listAll === 'function') {
    return chunkStore.listAll();
  }
  if (typeof chunkStore.listBySkill === 'function') {
    return chunkStore.listBySkill(skillKey);
  }
  if (typeof chunkStore.listAll === 'function') {
    return chunkStore.listAll();
  }
  return [];
}

function shouldIncludeCommonChunks(chunkStore, skillKey) {
  return skillKey !== 'common' && typeof chunkStore.listAll === 'function';
}
